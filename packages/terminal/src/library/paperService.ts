/**
 * Every change the terminal makes to the library: reading status, tags and note; moving and trashing papers;
 * creating, renaming, moving and trashing collections; importing PDFs, folders of PDFs, PDF URLs and identifiers
 * (DOI, arXiv, PMID, ISBN). Writes go through the core BibTeXService with the same "owned fields" rule the VS Code
 * PaperService uses, so metadata.yaml and bib.bib come out byte-for-byte as VS Code would write them, and keys another
 * app wrote are carried over.
 *
 * Titles are never rewritten here: Drive folders are named after titles (see core folderNames), and renaming one
 * outside a sync would make the next sync read it as a different paper.
 *
 * @depends @labshelf/core (BibTeXService, PdfImportParser, resolvers), library/*, platform/*
 * @dependents app/context, ui/app, cli/commands
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  detectIdentifiers,
  resolveOnlineMetadata,
  normalizeTitle,
  type BibTeXService,
  type DetectedIdentifier,
  type ILogger,
  type PaperRecord,
  type PaperStatus,
  type PdfImportParser,
  type ResolvedMetadata,
  PDF_FILE,
} from "@labshelf/core";

import { writeFileAtomic } from "../platform/nodeFileSystem.js";
import type { LibraryRoot } from "./libraryRoot.js";
import { readPaperFolder, type PaperEntry } from "./libraryScanner.js";
import type { LibraryStore } from "./libraryStore.js";

export interface PaperFieldsPatch {
  status?: PaperStatus;
  tags?: string[];
  note?: string;
}

export interface BatchOutcome {
  done: string[];
  failed: Array<{ id: string; error: string }>;
}

export type ImportOutcome =
  | { status: "added"; paper: PaperRecord; needsReview: boolean; input: string }
  | { status: "duplicate"; existingId: string; input: string }
  | { status: "failed"; error: string; input: string };

export interface ImportProgress {
  index: number;
  total: number;
  input: string;
}

export interface PaperServiceDeps {
  paths: LibraryRoot;
  store: LibraryStore;
  bibtex: BibTeXService;
  logger: ILogger;
  /** Built lazily: loading pdfjs costs ~100 ms and most sessions never import. */
  pdfParser: () => Promise<PdfImportParser>;
  trash: (target: string) => Promise<string>;
  fetch?: typeof fetch;
  /** Called after every change, so the sync service can schedule a debounced sync. */
  onLocalChange?: () => void;
  /** Network metadata lookup; injectable for tests. */
  resolveIdentifier?: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>;
}

const PDF_MAGIC = "%PDF-";
const STOPWORDS = new Set(["a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "from", "by", "at", "is", "are"]);
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Trimmed, de-duplicated case-insensitively (first spelling wins), order kept — the VS Code PaperService rule.
 * @usedBy TerminalPaperService.updateFields
 * @returns the tags
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

function slug(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * "authorYearWord" cite key (vaswani2017attention), the rule the browser extension uses for papers captured from
 * metadata; falls back to a timestamp.
 * @usedBy importIdentifier
 * @returns the cite key
 */
export function makeCiteKey(meta: ResolvedMetadata, fallbackTitle: string): string {
  const lastName = slug(meta.authors?.[0]?.trim().split(/\s+/).pop() ?? "");
  const year = meta.year ? String(meta.year) : "";
  const word = (meta.title ?? fallbackTitle).split(/\s+/).map(slug).find((w) => w.length > 1 && !STOPWORDS.has(w)) ?? "";
  return `${lastName}${year}${word}` || `paper${Date.now()}`;
}

/**
 * The key when free, otherwise key + a, b, … (BibTeX's convention). The key is the folder name and the paper id, so a
 * collision would overwrite another paper.
 * @usedBy importPdf, importIdentifier
 * @returns a free key
 */
export function uniqueCiteKey(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) { return base; }
  for (let i = 0; i < 26 * 26; i++) {
    const suffix = i < 26
      ? String.fromCharCode(97 + i)
      : String.fromCharCode(97 + Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26));
    if (!taken.has(`${base}${suffix}`.toLowerCase())) { return `${base}${suffix}`; }
  }
  return `${base}${Date.now()}`;
}

/**
 * Valid collection folder name: not empty, no slashes, not hidden, not "." or "..".
 * @usedBy TerminalPaperService, ui/app
 * @returns an error message, or undefined when valid
 */
export function validateCollectionName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) { return "The name cannot be empty."; }
  if (/[/\\]/.test(trimmed)) { return "Use a name without slashes."; }
  if (trimmed.startsWith(".")) { return "A collection name cannot start with a dot."; }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) { return "The name contains control characters."; }
  return undefined;
}

/**
 * Normalizes what the user typed in "add" into something detectIdentifiers understands (bare arXiv ids, doi: …).
 * @usedBy importIdentifier, importAny
 * @returns the identifiers found, best first
 */
export function identifiersIn(input: string): DetectedIdentifier[] {
  const text = input.trim();
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(text)) { return [{ type: "arxiv", value: text.replace(/v\d+$/, "") }]; }
  if (/^10\.\d{4,9}\/\S+$/.test(text)) { return [{ type: "doi", value: text }]; }
  return detectIdentifiers({}, text);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export class TerminalPaperService {
  constructor(private readonly deps: PaperServiceDeps) {}

  private get paths(): LibraryRoot { return this.deps.paths; }

  private async changed(): Promise<void> {
    await this.deps.store.reload();
    this.deps.onLocalChange?.();
  }

  // Re-reads the paper from disk right before a write: VS Code or a sync may have changed it since the last scan.
  private async fresh(id: string): Promise<PaperEntry | undefined> {
    const known = this.deps.store.paper(id);
    if (known) {
      const entry = await readPaperFolder(this.paths, known.record.path);
      if (entry) { return entry; }
    }
    // Moved or created by another app since the last scan: rescan once and look again.
    await this.deps.store.reload();
    const moved = this.deps.store.paper(id);
    return moved ? readPaperFolder(this.paths, moved.record.path) : undefined;
  }

  // Rewrites metadata.yaml and bib.bib. Tags and note belong to whoever set them: a rewrite that does not set them
  // leaves the file's own copy (same rule as the VS Code PaperService.writeArtifacts).
  private async writeArtifacts(paper: PaperRecord, owned: Pick<PaperRecord, "tags" | "note"> = {}): Promise<void> {
    const { tags: _tags, note: _note, hasPdf: _hasPdf, ...rest } = paper;
    await this.deps.bibtex.writePaperArtifacts(paper.path, { ...rest, ...owned }, path.join(paper.path, PDF_FILE));
  }

  /**
   * Changes reading status, tags and/or note of one paper; an unchanged patch writes nothing.
   * @usedBy ui/app, cli status/tag/note
   * @returns the updated record, or undefined when the paper is unknown
   */
  async updateFields(id: string, patch: PaperFieldsPatch, options: { reload?: boolean } = {}): Promise<PaperRecord | undefined> {
    const entry = await this.fresh(id);
    if (!entry) { return undefined; }
    const current = entry.record;
    const owned: Pick<PaperRecord, "tags" | "note"> = {};
    if (patch.tags !== undefined) { owned.tags = normalizeTags(patch.tags); }
    if (patch.note !== undefined) { owned.note = patch.note; }
    const next: PaperRecord = { ...current, ...(patch.status ? { status: patch.status } : {}), ...owned };
    const changed = next.status !== current.status
      || (owned.tags !== undefined && owned.tags.join("\n") !== (current.tags ?? []).join("\n"))
      || (owned.note !== undefined && owned.note !== (current.note ?? ""));
    if (!changed) { return current; }
    await this.writeArtifacts(next, owned);
    await this.deps.logger.log("INFO", "terminal/paperService", "Paper updated", { id, fields: Object.keys(patch) });
    if (options.reload !== false) { await this.changed(); }
    return next;
  }

  /**
   * Sets the status of several papers.
   * @usedBy ui/app
   * @returns ids changed and failures
   */
  async setStatus(ids: string[], status: PaperStatus): Promise<BatchOutcome> {
    return this.batch(ids, (id) => this.updateFields(id, { status }, { reload: false }));
  }

  /**
   * Adds and removes tags on several papers, keeping each paper's other tags.
   * @usedBy ui/app, cli tag
   * @returns ids changed and failures
   */
  async editTags(ids: string[], add: string[], remove: string[]): Promise<BatchOutcome> {
    const removeKeys = new Set(remove.map((t) => t.trim().toLowerCase()));
    return this.batch(ids, async (id) => {
      const entry = await this.fresh(id);
      if (!entry) { return undefined; }
      const kept = (entry.record.tags ?? []).filter((t) => !removeKeys.has(t.toLowerCase()));
      return this.updateFields(id, { tags: [...kept, ...add] }, { reload: false });
    });
  }

  private async batch(ids: string[], run: (id: string) => Promise<unknown>): Promise<BatchOutcome> {
    const outcome: BatchOutcome = { done: [], failed: [] };
    for (const id of ids) {
      try {
        if ((await run(id)) === undefined) {
          outcome.failed.push({ id, error: "Paper not found" });
        } else {
          outcome.done.push(id);
        }
      } catch (error) {
        outcome.failed.push({ id, error: describe(error) });
      }
    }
    await this.changed();
    return outcome;
  }

  /**
   * Moves paper folders into a collection; papers already there are skipped, name clashes fail.
   * @usedBy ui/app (paste, move picker), cli mv
   * @returns ids moved and failures
   */
  async movePapers(ids: string[], targetRel: string): Promise<BatchOutcome> {
    const targetDir = this.paths.collectionDir(targetRel);
    const outcome: BatchOutcome = { done: [], failed: [] };
    if (!(await exists(targetDir))) {
      return { done: [], failed: ids.map((id) => ({ id, error: `Collection "${targetRel}" does not exist` })) };
    }
    for (const id of ids) {
      const entry = this.deps.store.paper(id);
      if (!entry) {
        outcome.failed.push({ id, error: "Paper not found" });
        continue;
      }
      if (path.dirname(entry.record.path) === targetDir) { continue; }
      const destination = path.join(targetDir, path.basename(entry.record.path));
      try {
        if (await exists(destination)) { throw new Error(`"${path.basename(destination)}" already exists there`); }
        await fs.rename(entry.record.path, destination);
        outcome.done.push(id);
      } catch (error) {
        outcome.failed.push({ id, error: describe(error) });
      }
    }
    if (outcome.done.length) {
      await this.deps.logger.log("INFO", "terminal/paperService", "Papers moved", { ids: outcome.done, targetRel });
    }
    await this.changed();
    return outcome;
  }

  /**
   * Moves paper folders to the system trash (sidecars stay, as in VS Code, so a restored paper keeps its notes).
   * @usedBy ui/app, cli rm
   * @returns ids trashed and failures
   */
  async trashPapers(ids: string[]): Promise<BatchOutcome> {
    const outcome: BatchOutcome = { done: [], failed: [] };
    for (const id of ids) {
      const entry = this.deps.store.paper(id);
      if (!entry) {
        outcome.failed.push({ id, error: "Paper not found" });
        continue;
      }
      try {
        await this.deps.trash(entry.record.path);
        outcome.done.push(id);
      } catch (error) {
        outcome.failed.push({ id, error: describe(error) });
      }
    }
    if (outcome.done.length) {
      await this.deps.logger.log("INFO", "terminal/paperService", "Papers moved to trash", { ids: outcome.done });
    }
    await this.changed();
    return outcome;
  }

  /**
   * Creates a collection folder.
   * @usedBy ui/app, cli mkdir
   * @returns the new collection path
   */
  async createCollection(parentRel: string, name: string): Promise<string> {
    const problem = validateCollectionName(name);
    if (problem) { throw new Error(problem); }
    const dir = path.join(this.paths.collectionDir(parentRel), name.trim());
    if (await exists(dir)) { throw new Error(`"${name.trim()}" already exists`); }
    await fs.mkdir(dir, { recursive: true });
    await this.changed();
    return parentRel ? `${parentRel}/${name.trim()}` : name.trim();
  }

  /**
   * Renames a collection folder.
   * @usedBy ui/app
   * @returns the collection's new path
   */
  async renameCollection(rel: string, newName: string): Promise<string> {
    if (!rel) { throw new Error("The library root cannot be renamed"); }
    const problem = validateCollectionName(newName);
    if (problem) { throw new Error(problem); }
    const from = this.paths.collectionDir(rel);
    const to = path.join(path.dirname(from), newName.trim());
    if (from === to) { return rel; }
    // On a case-insensitive disk (macOS) "ml" → "ML" finds the folder itself; that rename is allowed.
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (!caseOnly && (await exists(to))) { throw new Error(`"${newName.trim()}" already exists`); }
    await fs.rename(from, to);
    await this.changed();
    return this.paths.relativeCollection(to);
  }

  /**
   * Moves a collection (with everything in it) under another collection.
   * @usedBy ui/app (paste)
   * @returns the collection's new path
   */
  async moveCollection(rel: string, targetParentRel: string): Promise<string> {
    if (!rel) { throw new Error("The library root cannot be moved"); }
    if (targetParentRel === rel || targetParentRel.startsWith(rel + "/")) {
      throw new Error("A collection cannot be moved into itself");
    }
    const from = this.paths.collectionDir(rel);
    const to = path.join(this.paths.collectionDir(targetParentRel), path.basename(from));
    if (path.dirname(from) === path.dirname(to)) { return rel; }
    if (await exists(to)) { throw new Error(`"${path.basename(from)}" already exists there`); }
    await fs.rename(from, to);
    await this.changed();
    return this.paths.relativeCollection(to);
  }

  /**
   * Moves a collection folder and everything in it to the trash.
   * @usedBy ui/app
   * @returns void
   */
  async trashCollection(rel: string): Promise<void> {
    if (!rel) { throw new Error("The library root cannot be deleted"); }
    await this.deps.trash(this.paths.collectionDir(rel));
    await this.deps.logger.log("INFO", "terminal/paperService", "Collection moved to trash", { rel });
    await this.changed();
  }

  private takenIds(): Set<string> {
    return new Set([...this.deps.store.snapshot.papers.keys()].map((id) => id.toLowerCase()));
  }

  private findByDoi(doi: string | undefined): PaperEntry | undefined {
    if (!doi) { return undefined; }
    const key = doi.toLowerCase();
    return [...this.deps.store.snapshot.papers.values()].find((e) => e.record.doi?.toLowerCase() === key);
  }

  private async freeFolder(targetDir: string, base: string): Promise<string> {
    const taken = this.takenIds();
    let id = uniqueCiteKey(base, taken);
    // A folder can exist without being a paper the scan knows (a sync in flight, an orphan PDF folder).
    while (await exists(path.join(targetDir, id))) {
      taken.add(id.toLowerCase());
      id = uniqueCiteKey(base, taken);
    }
    return id;
  }

  /**
   * Imports one PDF file, the way VS Code's "Add Paper" does: metadata from the file and the registries, the PDF copied
   * to <collection>/<citeKey>/paper.pdf, metadata.yaml and bib.bib written beside it.
   * @usedBy importAny
   * @returns what happened
   */
  async importPdf(file: string, targetRel: string, options: { sourceName?: string } = {}): Promise<ImportOutcome> {
    const input = options.sourceName ?? file;
    try {
      const bytes = new Uint8Array(await fs.readFile(file));
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== PDF_MAGIC) { throw new Error("Not a PDF file"); }
      const stem = path.basename(options.sourceName ?? file, path.extname(options.sourceName ?? file));
      const parsed = await (await this.deps.pdfParser()).parse(bytes, stem);
      const duplicate = this.findByDoi(parsed.doi);
      if (duplicate) { return { status: "duplicate", existingId: duplicate.record.id, input }; }

      const targetDir = this.paths.collectionDir(targetRel);
      const id = await this.freeFolder(targetDir, parsed.citeKey || slug(stem) || `paper${Date.now()}`);
      const folder = path.join(targetDir, id);
      await fs.mkdir(folder, { recursive: true });
      await writeFileAtomic(path.join(folder, PDF_FILE), bytes, this.paths.layout.tmpDir());
      const paper: PaperRecord = {
        id,
        title: parsed.title,
        path: folder,
        citeKey: id,
        status: "unread",
        hasPdf: true,
        ...pickMetadata(parsed),
      };
      await this.deps.bibtex.writePaperArtifacts(folder, withoutDerived(paper), options.sourceName ?? file);
      await this.deps.logger.log("INFO", "terminal/paperService", "Paper imported from PDF", {
        id, source: parsed.source, confidence: parsed.confidence, targetRel,
      });
      return { status: "added", paper, needsReview: parsed.confidence !== "high" && !parsed.doi, input };
    } catch (error) {
      await this.deps.logger.log("WARN", "terminal/paperService", "PDF import failed", { file, message: describe(error) });
      return { status: "failed", error: describe(error), input };
    }
  }

  /**
   * Imports a paper from an identifier (DOI, arXiv id, PMID, ISBN or a URL containing one). arXiv papers come with
   * their PDF; others are saved as a reference without a PDF, like the browser extension does.
   * @usedBy importAny
   * @returns what happened
   */
  async importIdentifier(input: string, targetRel: string): Promise<ImportOutcome> {
    const identifiers = identifiersIn(input);
    if (!identifiers.length) { return { status: "failed", error: "No DOI, arXiv id, PMID or ISBN found", input }; }
    const resolve = this.deps.resolveIdentifier ?? resolveOnlineMetadata;
    try {
      let metadata: ResolvedMetadata | undefined;
      let identifier: DetectedIdentifier | undefined;
      for (const candidate of identifiers) {
        metadata = await resolve(candidate).catch(() => undefined);
        if (metadata?.title) {
          identifier = candidate;
          break;
        }
      }
      if (!metadata?.title || !identifier) {
        return { status: "failed", error: `Could not find ${identifiers[0]!.type.toUpperCase()} ${identifiers[0]!.value}`, input };
      }
      const duplicate = this.findByDoi(metadata.doi ?? (identifier.type === "doi" ? identifier.value : undefined));
      if (duplicate) { return { status: "duplicate", existingId: duplicate.record.id, input }; }

      let pdf: Uint8Array | undefined;
      if (identifier.type === "arxiv") {
        pdf = await this.download(`https://arxiv.org/pdf/${identifier.value}`).catch(() => undefined);
      }
      const title = normalizeTitle(metadata.title);
      const targetDir = this.paths.collectionDir(targetRel);
      const id = await this.freeFolder(targetDir, makeCiteKey({ ...metadata, title }, title));
      const folder = path.join(targetDir, id);
      await fs.mkdir(folder, { recursive: true });
      if (pdf) { await writeFileAtomic(path.join(folder, PDF_FILE), pdf, this.paths.layout.tmpDir()); }
      const paper: PaperRecord = {
        id,
        title,
        path: folder,
        citeKey: id,
        status: "unread",
        hasPdf: Boolean(pdf),
        ...pickMetadata(metadata),
        ...(identifier.type === "doi" && !metadata.doi ? { doi: identifier.value } : {}),
        ...(identifier.type === "arxiv" && !metadata.url ? { url: `https://arxiv.org/abs/${identifier.value}` } : {}),
      };
      const sourceName = identifier.type === "arxiv" ? `${identifier.value}.pdf` : PDF_FILE;
      await this.deps.bibtex.writePaperArtifacts(folder, withoutDerived(paper), sourceName);
      await this.deps.logger.log("INFO", "terminal/paperService", "Paper imported from identifier", {
        id, type: identifier.type, value: identifier.value, withPdf: Boolean(pdf), targetRel,
      });
      return { status: "added", paper, needsReview: false, input };
    } catch (error) {
      await this.deps.logger.log("WARN", "terminal/paperService", "Identifier import failed", { input, message: describe(error) });
      return { status: "failed", error: describe(error), input };
    }
  }

  // Downloads a PDF, checking the magic bytes so an HTML landing page is never saved as paper.pdf.
  private async download(url: string): Promise<Uint8Array> {
    const doFetch = this.deps.fetch ?? fetch;
    const response = await doFetch(url, { redirect: "follow", headers: { "User-Agent": "LabShelf-Terminal/0.1" } });
    if (!response.ok) { throw new Error(`Download failed: HTTP ${response.status}`); }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_DOWNLOAD_BYTES) { throw new Error("The file is too large"); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== PDF_MAGIC) { throw new Error("The URL did not return a PDF"); }
    return bytes;
  }

  /**
   * Imports whatever the user typed or passed on the command line: a PDF, a folder of PDFs (recursively), a PDF URL,
   * or an identifier. Changes are announced once at the end.
   * @usedBy ui/app (a), cli add
   * @returns one outcome per imported item
   */
  async importAny(inputs: string[], targetRel: string, onProgress?: (progress: ImportProgress) => void): Promise<ImportOutcome[]> {
    const items: Array<{ kind: "pdf" | "url" | "identifier"; value: string }> = [];
    const outcomes: ImportOutcome[] = [];
    for (const raw of inputs) {
      const input = raw.trim();
      if (!input) { continue; }
      const local = path.resolve(input.replace(/^~(?=$|\/)/, process.env["HOME"] ?? "~"));
      const stat = await fs.stat(local).catch(() => undefined);
      if (stat?.isDirectory()) {
        for (const pdf of await findPdfs(local)) { items.push({ kind: "pdf", value: pdf }); }
      } else if (stat?.isFile()) {
        items.push({ kind: "pdf", value: local });
      } else if (/^https?:\/\//i.test(input) && identifiersIn(input).length === 0) {
        items.push({ kind: "url", value: input });
      } else {
        items.push({ kind: "identifier", value: input });
      }
    }
    for (const [index, item] of items.entries()) {
      onProgress?.({ index: index + 1, total: items.length, input: item.value });
      if (item.kind === "pdf") {
        outcomes.push(await this.importPdf(item.value, targetRel));
      } else if (item.kind === "url") {
        outcomes.push(await this.importUrl(item.value, targetRel));
      } else {
        outcomes.push(await this.importIdentifier(item.value, targetRel));
      }
      // Later items must see the ids earlier ones took.
      await this.deps.store.reload();
    }
    if (outcomes.some((o) => o.status === "added")) { this.deps.onLocalChange?.(); }
    return outcomes;
  }

  private async importUrl(url: string, targetRel: string): Promise<ImportOutcome> {
    let tmp: string | undefined;
    try {
      const bytes = await this.download(url);
      await fs.mkdir(this.paths.layout.tmpDir(), { recursive: true });
      tmp = path.join(this.paths.layout.tmpDir(), `download-${Date.now()}.pdf`);
      await fs.writeFile(tmp, bytes);
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download.pdf");
      return await this.importPdf(tmp, targetRel, { sourceName: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf` });
    } catch (error) {
      return { status: "failed", error: describe(error), input: url };
    } finally {
      if (tmp) { await fs.rm(tmp, { force: true }).catch(() => undefined); }
    }
  }

  /**
   * BibTeX entries for papers, without the local file line (what VS Code's "Copy BibTeX" produces).
   * @usedBy ui/app (yank), cli bib
   * @returns the entries separated by blank lines
   */
  bibtexFor(records: PaperRecord[]): string {
    return records.map((r) => this.deps.bibtex.generateBibTeX(r, { includeFile: false })).join("\n\n") + "\n";
  }
}

function pickMetadata(meta: ResolvedMetadata & { authors?: string[] | undefined }): Partial<PaperRecord> {
  const out: Partial<PaperRecord> = {};
  if (meta.authors?.length) { out.authors = meta.authors; }
  if (meta.year) { out.year = meta.year; }
  for (const key of ["summary", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language"] as const) {
    const value = meta[key];
    if (value) { out[key] = value; }
  }
  if (meta.keywords?.length) { out.keywords = meta.keywords; }
  return out;
}

// hasPdf is derived from the folder by every surface and never stored.
function withoutDerived(paper: PaperRecord): PaperRecord {
  const { hasPdf: _hasPdf, ...rest } = paper;
  return rest;
}

async function findPdfs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) { continue; }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findPdfs(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      out.push(full);
    }
  }
  return out.sort();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
