/**
 * Every change the terminal makes to the library. The mutations themselves are core's; this class maps collection paths
 * to folders, finds papers that moved since the last scan, and reloads the store and tells the sync after each change.
 *
 * Titles are never rewritten: Drive folders are named after titles (see core folderNames), and renaming one outside a
 * sync would make the next sync read it as a different paper.
 */
import * as path from "node:path";

import {
  createFolder,
  doiLookup,
  editPaperTags,
  importPdf,
  METADATA_FILE,
  moveFolder,
  movePapers,
  renameFolder,
  setPaperStatus,
  trashFolder,
  trashPapers,
  updatePaperFields,
  type BatchOutcome,
  type BibTeXService,
  type DetectedIdentifier,
  type ILogger,
  type ImportDeps,
  type ImportOutcome,
  type ImportProgress,
  type MutationContext,
  type PaperFieldsPatch,
  type PaperRecord,
  type PaperRef,
  type PaperStatus,
  type PdfImportParser,
  type ResolvedMetadata,
} from "@labshelf/core";
import { NodeLibraryFileSystem } from "@labshelf/core/node";

import type { LibraryRoot } from "../libraryRoot.js";
import type { LibraryStore } from "../libraryStore.js";
import { planImports, type ImportItem } from "./importInputs.js";
import { importIdentifier, importUrl, type NetworkImportEnv } from "./networkImport.js";

export interface PaperServiceDeps {
  paths: LibraryRoot;
  store: LibraryStore;
  bibtex: BibTeXService;
  logger: ILogger;
  /** Built lazily: loading pdfjs costs ~100 ms and most sessions never import. */
  pdfParser: () => Promise<PdfImportParser>;
  trash: (target: string) => Promise<unknown>;
  fetch?: typeof fetch;
  /** Called after every change, so the sync service can schedule a debounced sync. */
  onLocalChange?: () => void;
  /** Network metadata lookup; injectable for tests. */
  resolveIdentifier?: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>;
}

export class TerminalPaperService {
  private readonly ctx: MutationContext;
  private readonly network: NetworkImportEnv;

  constructor(private readonly deps: PaperServiceDeps) {
    this.ctx = {
      fs: new NodeLibraryFileSystem(deps.trash, deps.paths.layout.tmpDir()),
      paths: path,
      artifacts: deps.bibtex,
      logger: deps.logger,
      papersRoot: deps.paths.layout.papersRoot(),
    };
    this.network = {
      ctx: this.ctx,
      tmpDir: deps.paths.layout.tmpDir(),
      importDeps: () => this.importDeps(),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.resolveIdentifier ? { resolveIdentifier: deps.resolveIdentifier } : {}),
    };
  }

  private get paths(): LibraryRoot { return this.deps.paths; }

  private async changed(): Promise<void> {
    await this.deps.store.reload();
    this.deps.onLocalChange?.();
  }

  private importDeps(): ImportDeps {
    const papers = this.deps.store.snapshot.papers;
    return {
      parse: async (bytes, stem) => (await this.deps.pdfParser()).parse(bytes, stem),
      findByDoi: doiLookup([...papers.values()].map((entry) => entry.record)),
      takenIds: () => papers.keys(),
    };
  }

  // VS Code or a sync may have moved the paper since the last scan: rescan once and look again.
  private async folderOf(id: string): Promise<string | undefined> {
    const known = this.deps.store.paper(id)?.record.path;
    if (known && (await this.ctx.fs.exists(path.join(known, METADATA_FILE)))) { return known; }
    await this.deps.store.reload();
    return this.deps.store.paper(id)?.record.path;
  }

  private async refs(ids: string[], rescan: boolean): Promise<{ refs: PaperRef[]; missing: BatchOutcome["failed"] }> {
    const refs: PaperRef[] = [];
    const missing: BatchOutcome["failed"] = [];
    for (const id of ids) {
      const folder = rescan ? await this.folderOf(id) : this.deps.store.paper(id)?.record.path;
      if (folder) { refs.push({ id, path: folder }); } else { missing.push({ id, error: "Paper not found" }); }
    }
    return { refs, missing };
  }

  private async finish(outcome: BatchOutcome, missing: BatchOutcome["failed"]): Promise<BatchOutcome> {
    await this.changed();
    return { done: outcome.done, failed: [...missing, ...outcome.failed] };
  }

  /**
   * Changes reading status, tags and/or note of one paper.
   * @returns the updated record, or undefined when the paper is unknown
   */
  async updateFields(id: string, patch: PaperFieldsPatch): Promise<PaperRecord | undefined> {
    const folder = await this.folderOf(id);
    const record = folder ? await updatePaperFields(this.ctx, folder, patch) : undefined;
    if (record) { await this.changed(); }
    return record;
  }

  /** @returns ids changed and failures */
  async setStatus(ids: string[], status: PaperStatus): Promise<BatchOutcome> {
    const { refs, missing } = await this.refs(ids, true);
    return this.finish(await setPaperStatus(this.ctx, refs, status), missing);
  }

  /** @returns ids changed and failures */
  async editTags(ids: string[], add: string[], remove: string[]): Promise<BatchOutcome> {
    const { refs, missing } = await this.refs(ids, true);
    return this.finish(await editPaperTags(this.ctx, refs, add, remove), missing);
  }

  /** @returns ids moved and failures */
  async movePapers(ids: string[], targetRel: string): Promise<BatchOutcome> {
    const { refs, missing } = await this.refs(ids, false);
    return this.finish(await movePapers(this.ctx, refs, this.paths.collectionDir(targetRel)), missing);
  }

  /** @returns ids trashed and failures */
  async trashPapers(ids: string[]): Promise<BatchOutcome> {
    const { refs, missing } = await this.refs(ids, false);
    return this.finish(await trashPapers(this.ctx, refs), missing);
  }

  /** @returns the new collection's path relative to papers/ */
  async createCollection(parentRel: string, name: string): Promise<string> {
    const dir = await createFolder(this.ctx, this.paths.collectionDir(parentRel), name);
    await this.changed();
    return this.paths.relativeCollection(dir);
  }

  /** @returns the collection's new path */
  async renameCollection(rel: string, newName: string): Promise<string> {
    const dir = await renameFolder(this.ctx, this.paths.collectionDir(rel), newName);
    await this.changed();
    return this.paths.relativeCollection(dir);
  }

  /** @returns the collection's new path */
  async moveCollection(rel: string, targetParentRel: string): Promise<string> {
    const dir = await moveFolder(this.ctx, this.paths.collectionDir(rel), this.paths.collectionDir(targetParentRel));
    await this.changed();
    return this.paths.relativeCollection(dir);
  }

  async trashCollection(rel: string): Promise<void> {
    await trashFolder(this.ctx, this.paths.collectionDir(rel));
    await this.changed();
  }

  /**
   * Imports whatever the user typed or passed on the command line: a PDF, a folder of PDFs (recursively), a PDF URL,
   * or an identifier. Changes are announced once at the end.
   * @returns one outcome per imported item
   */
  async importAny(inputs: string[], targetRel: string, onProgress?: (progress: ImportProgress) => void): Promise<ImportOutcome[]> {
    const targetDir = this.paths.collectionDir(targetRel);
    const items = await planImports(this.ctx, inputs);
    const total = items.filter((item) => item.kind !== "skipped").length;
    const outcomes: ImportOutcome[] = [];
    let index = 0;
    for (const item of items) {
      if (item.kind === "skipped") {
        outcomes.push({ status: "skipped", input: item.value });
        continue;
      }
      onProgress?.({ index: ++index, total, input: item.value });
      outcomes.push(await this.importItem(item, targetDir));
      // Later items must see the ids earlier ones took.
      await this.deps.store.reload();
    }
    if (outcomes.some((outcome) => outcome.status === "added")) { this.deps.onLocalChange?.(); }
    return outcomes;
  }

  private importItem(item: ImportItem, targetDir: string): Promise<ImportOutcome> {
    if (item.kind === "pdf") { return importPdf(this.ctx, this.importDeps(), item.value, targetDir); }
    if (item.kind === "url") { return importUrl(this.network, item.value, targetDir); }
    return importIdentifier(this.network, item.value, targetDir);
  }

  /**
   * BibTeX entries for papers, without the local file line (what VS Code's "Copy BibTeX" produces).
   * @returns the entries separated by blank lines
   */
  bibtexFor(records: PaperRecord[]): string {
    return records.map((r) => this.deps.bibtex.generateBibTeX(r, { includeFile: false })).join("\n\n") + "\n";
  }
}
