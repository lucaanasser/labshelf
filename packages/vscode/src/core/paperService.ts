/**
 * Orchestrates paper import, metadata persistence, status updates, and deletion.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import {
  EVENTS,
  EventBus,
  PdfImportParser,
  BibTeXService,
  FolderService,
  citeKeySlug,
  claimCiteKey,
  isPaperStatus,
  isUnderDir,
  normalizeTags,
  paperFiles,
  parsePaperMetadata,
} from "@labshelf/core";
import type {
  IFileSystem,
  LibraryLayout,
  PaperRecord,
  BatchImportResult,
  IResearchDatabase,
  ResolvedMetadata,
  ParsedPdfImport,
  TextLayerInfo,
} from "@labshelf/core";
import type { PdfTextLayerBuilder, TextLayerHooks, TextLayerOutcome } from "../pdf/searchablePdfBuilder.js";

/** What happened when a paper was checked for, and possibly given, a text layer. */
export type MakeSearchableResult =
  | { status: "added"; paper: PaperRecord; pagesAdded: number; pagesFailed: number }
  | { status: "not-needed" | "cancelled" }
  // skipped: needs OCR but was deliberately not read; unavailable: OCR failed.
  | { status: "skipped" | "unavailable"; reason: string };

/** One step of a batch import, reported just before the file is processed. */
export interface ImportProgress {
  // 1-based position of the file about to be imported.
  index: number;
  total: number;
  fileName: string;
}

/** The fields of a paper the user edits by hand; absent keys are left as they are. */
export interface PaperFieldsPatch {
  status?: PaperRecord["status"];
  tags?: string[];
  note?: string;
}

export interface PaperMoveResult {
  moved: string[];
  failed: Array<{ id: string; error: string }>;
}

export class PaperService {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly database: IResearchDatabase,
    private readonly eventBus: EventBus,
    private readonly paths: LibraryLayout<vscode.Uri>,
    private readonly pdfImportParser: PdfImportParser,
    private readonly bibTeXService: BibTeXService,
    // Classifies PDFs and, when OCR is on, gives scans a text layer.
    private readonly textLayerBuilder?: PdfTextLayerBuilder,
  ) {}

  // Set by the most recent addPaperFromUri so batch imports can collect the
  // papers no registry confirmed, without changing the single-import signature.
  private _lastImportNeedsReview = false;

  /**
   * Imports a single PDF, copies it into the library, persists metadata, and emits PAPER_ADDED.
   * @returns the newly created PaperRecord
   */
  async addPaperFromUri(sourceUri: vscode.Uri, targetParentDir?: vscode.Uri): Promise<PaperRecord> {
    const pdfBytes = await vscode.workspace.fs.readFile(sourceUri);
    const fileStem = path.basename(sourceUri.fsPath, path.extname(sourceUri.fsPath));
    const parsed = await this.pdfImportParser.parse(pdfBytes, fileStem);
    const parentDir = targetParentDir ?? this.paths.papersRoot();
    // The id is also the folder name: a taken one would overwrite another paper's PDF.
    const paperId = await claimCiteKey(
      parsed.citeKey || citeKeySlug(fileStem) || `paper${Date.now()}`,
      (await this.database.listPapers()).map((paper) => paper.id),
      (key) => this.folderExists(vscode.Uri.joinPath(parentDir, key)),
    );
    const targetFolder = vscode.Uri.joinPath(parentDir, paperId);
    await this.fileSystem.ensureDir(targetFolder.fsPath);

    const targetPdf = paperFiles(targetFolder, vscode.Uri.joinPath).pdf;
    // Guard against a PDF backend that transfers (detaches) the buffer it parses:
    // writing a detached array would store an unreadable zero-byte paper.pdf.
    if (pdfBytes.byteLength === 0) {
      throw new Error("PDF buffer was consumed during parsing; the file could not be copied into the library.");
    }
    await vscode.workspace.fs.writeFile(targetPdf, pdfBytes);

    const paper = importedPaperRecord(paperId, targetFolder.fsPath, parsed);

    await this.database.upsertPaper(paper);
    await this.bibTeXService.writePaperArtifacts(targetFolder.fsPath, paper, sourceUri.fsPath);
    this.eventBus.emit(EVENTS.PAPER_ADDED, paper);
    this._lastImportNeedsReview = needsReview(parsed);
    return paper;
  }

  private async folderExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Overwrites a paper's bibliographic fields with a freshly resolved record
   * and rewrites its BibTeX artifacts; emits PAPER_UPDATED.
   * @returns the updated PaperRecord, or undefined when the paper is unknown
   */
  async applyResolvedMetadata(paperId: string, metadata: ResolvedMetadata): Promise<PaperRecord | undefined> {
    const papers = await this.database.listPapers();
    const current = papers.find((paper) => paper.id === paperId);
    if (!current) {
      return undefined;
    }

    // Keep identity fields: the folder on disk is named after the cite key.
    const updated: PaperRecord = {
      ...current,
      ...(metadata.title ? { title: metadata.title } : {}),
      ...(metadata.authors?.length ? { authors: metadata.authors } : {}),
      ...(metadata.year ? { year: metadata.year } : {}),
      ...(metadata.summary ? { summary: metadata.summary } : {}),
      ...(metadata.journal ? { journal: metadata.journal } : {}),
      ...(metadata.publisher ? { publisher: metadata.publisher } : {}),
      ...(metadata.volume ? { volume: metadata.volume } : {}),
      ...(metadata.issue ? { issue: metadata.issue } : {}),
      ...(metadata.pages ? { pages: metadata.pages } : {}),
      ...(metadata.doi ? { doi: metadata.doi } : {}),
      ...(metadata.url ? { url: metadata.url } : {}),
      ...(metadata.issn ? { issn: metadata.issn } : {}),
      ...(metadata.language ? { language: metadata.language } : {}),
      ...(metadata.keywords?.length ? { keywords: metadata.keywords } : {}),
    };

    await this.database.upsertPaper(updated);
    await this.writeArtifacts(updated);
    this.eventBus.emit(EVENTS.PAPER_UPDATED, updated);
    return updated;
  }

  /**
   * Re-runs the full extraction pipeline against a paper already in the
   * library. Recovers records that were imported while offline, before the
   * pipeline improved, or when a registry was rate-limiting.
   * @returns the updated paper, or undefined when nothing better was found
   */
  async refreshMetadataFromPdf(paperId: string): Promise<PaperRecord | undefined> {
    const papers = await this.database.listPapers();
    const paper = papers.find((entry) => entry.id === paperId);
    if (!paper) {
      return undefined;
    }

    const pdfUri = vscode.Uri.file(paperFiles(paper.path, path.join).pdf);
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await vscode.workspace.fs.readFile(pdfUri);
    } catch {
      return undefined;
    }
    if (pdfBytes.byteLength === 0) {
      return undefined;
    }

    const parsed = await this.pdfImportParser.parse(pdfBytes, paper.citeKey);
    // Only overwrite when the pipeline actually recognised the paper this time;
    // a second guess is not better than the guess already stored.
    if (parsed.confidence === "low" || (!parsed.doi && parsed.confidence !== "high")) {
      return undefined;
    }

    return this.applyResolvedMetadata(paperId, parsed);
  }

  /**
   * Gives a scanned paper a text layer so it can be searched and selected, and
   * replaces paper.pdf with the result. Whatever happens, the verdict is
   * recorded on the paper (textLayer) so the library can show it; papers that
   * already have text are only marked as such.
   * @returns what was done, or why nothing could be
   */
  async makeSearchable(paperId: string, hooks?: TextLayerHooks): Promise<MakeSearchableResult> {
    if (!this.textLayerBuilder) {
      return { status: "unavailable", reason: "text layer support is not available" };
    }
    const paper = await this._findPaper(paperId);
    if (!paper) {
      return { status: "unavailable", reason: "paper not found" };
    }
    // A paper saved without a PDF has nothing to read: skip quietly instead of
    // letting the read throw and recording a bogus "failed" verdict.
    if (!(await this._pdfExists(paper))) {
      return { status: "skipped", reason: "it has no PDF" };
    }

    let outcome: TextLayerOutcome;
    try {
      outcome = await this.textLayerBuilder.build(await this._readPdf(paper), hooks);
    } catch (error) {
      outcome = { status: "unavailable", reason: describeError(error) };
    }

    if (outcome.status !== "added") {
      await this.recordTextLayer(paperId, verdictFor(outcome));
      return outcome;
    }

    // Reading a scan takes the better part of a minute, in which the paper may
    // have been moved or removed; the file goes wherever it is now.
    const current = await this._findPaper(paperId);
    if (!current) {
      return { status: "unavailable", reason: "the paper was removed while it was being read" };
    }
    const pdfUri = vscode.Uri.file(paperFiles(current.path, path.join).pdf);
    // Written beside the original and renamed over it, so an interrupted write
    // can never leave the library with half a paper.
    const pendingUri = vscode.Uri.file(path.join(current.path, "paper.searchable.tmp"));
    await vscode.workspace.fs.writeFile(pendingUri, outcome.bytes);
    await vscode.workspace.fs.rename(pendingUri, pdfUri, { overwrite: true });

    const updated = await this.recordTextLayer(paperId, verdictFor(outcome), { force: true });
    return { status: "added", paper: updated ?? current, pagesAdded: outcome.pagesAdded, pagesFailed: outcome.pagesFailed };
  }

  /**
   * Records whether a paper's PDF has text of its own, without reading any page
   * optically. Used to label papers imported before text layers were tracked.
   * @returns the updated paper, or undefined when it is unknown or could not be checked
   */
  async checkTextLayer(paperId: string): Promise<PaperRecord | undefined> {
    const paper = await this._findPaper(paperId);
    if (!this.textLayerBuilder || !paper) {
      return undefined;
    }
    // Nothing on disk to classify: leave the record untouched (no verdict, no
    // metadata.yaml rewrite, no event) so PDF-less papers stay clean.
    if (!(await this._pdfExists(paper))) {
      return paper;
    }
    let verdict: TextLayerInfo;
    try {
      const detection = await this.textLayerBuilder.detect(await this._readPdf(paper));
      verdict =
        detection.status === "missing" ? { state: "missing", checkedAt: now() }
        : detection.status === "unavailable" ? { state: "failed", reason: detection.reason, checkedAt: now() }
        : { state: detection.status, checkedAt: now() };
    } catch (error) {
      verdict = { state: "failed", reason: describeError(error), checkedAt: now() };
    }
    return this.recordTextLayer(paperId, verdict);
  }

  // Stores a verdict on the freshest copy of the record, so a status change or
  // move made while a page was being read is not undone. An unchanged verdict
  // is not rewritten, which keeps a library-wide check from touching every file.
  private async recordTextLayer(
    paperId: string,
    verdict: TextLayerInfo,
    options: { force?: boolean } = {},
  ): Promise<PaperRecord | undefined> {
    const current = await this._findPaper(paperId);
    if (!current) {
      return undefined;
    }
    if (!options.force && (sameVerdict(current.textLayer, verdict) || keepsOcrDetail(current.textLayer, verdict))) {
      return current;
    }
    const updated: PaperRecord = { ...current, textLayer: verdict };
    await this.database.upsertPaper(updated);
    await this.writeArtifacts(updated);
    this.eventBus.emit(EVENTS.PAPER_UPDATED, updated);
    return updated;
  }

  // Rewrites metadata.yaml and the .bib file. Tags and the note belong to whoever set them: a rewrite that does not
  // set them leaves the file's own copy, which a sync may have changed since the index was built.
  // The reading status, too, belongs to whoever set it: a rewrite that does not (a text-layer verdict, resolved
  // metadata) keeps the file's own status, which the terminal app or a sync may have changed after the index was built.
  private async writeArtifacts(
    paper: PaperRecord,
    owned: Pick<PaperRecord, "tags" | "note"> = {},
    options: { ownsStatus?: boolean } = {},
  ): Promise<void> {
    const { tags: _tags, note: _note, ...rest } = paper;
    const status = options.ownsStatus ? paper.status : (await this._statusOnDisk(paper)) ?? paper.status;
    await this.bibTeXService.writePaperArtifacts(paper.path, { ...rest, status, ...owned }, paperFiles(paper.path, path.join).pdf);
  }

  private async _statusOnDisk(paper: PaperRecord): Promise<PaperRecord["status"] | undefined> {
    try {
      const status = parsePaperMetadata(await this.fileSystem.readText(paperFiles(paper.path, path.join).metadata))?.["status"];
      return isPaperStatus(status) ? status : undefined;
    } catch {
      return undefined;
    }
  }

  private async _findPaper(paperId: string): Promise<PaperRecord | undefined> {
    return (await this.database.listPapers()).find((entry) => entry.id === paperId);
  }

  private async _readPdf(paper: PaperRecord): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.file(paperFiles(paper.path, path.join).pdf));
  }

  // Authoritative presence check at action time. Uses vscode.workspace.fs
  // directly (as _expandToPdfs does): IFileSystem.exists also reports
  // true for a directory, and the test double has no exists. FileType is a bit
  // flag, so a symlink to a file reports File|SymbolicLink — test the bit.
  private async _pdfExists(paper: PaperRecord): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(paperFiles(paper.path, path.join).pdf));
      return (stat.type & vscode.FileType.File) !== 0;
    } catch {
      return false;
    }
  }

  /**
   * Re-checks whether a paper's PDF is on disk and, when the stored flag is
   * stale, corrects it and emits PAPER_UPDATED. hasPdf is derived, so this only
   * touches the index — never metadata.yaml.
   * @returns the current record and its real hasPdf, or undefined when unknown
   */
  async reconcilePdf(paperId: string): Promise<{ paper: PaperRecord; hasPdf: boolean } | undefined> {
    const current = await this._findPaper(paperId);
    if (!current) {
      return undefined;
    }
    const hasPdf = await this._pdfExists(current);
    if (current.hasPdf === hasPdf) {
      return { paper: current, hasPdf };
    }
    const updated: PaperRecord = { ...current, hasPdf };
    await this.database.upsertPaper(updated);
    this.eventBus.emit(EVENTS.PAPER_UPDATED, updated);
    return { paper: updated, hasPdf };
  }

  /**
   * Returns every paper whose record was never confirmed against a registry.
   * @returns papers worth re-resolving or filling in by hand
   */
  async listUnresolvedPapers(): Promise<PaperRecord[]> {
    const papers = await this.database.listPapers();
    return papers.filter((paper) => !paper.doi);
  }

  /**
   * Returns all papers currently stored in the database, ordered by title.
   * @returns array of PaperRecord
   */
  async listPapers(): Promise<PaperRecord[]> {
    return this.database.listPapers();
  }

  /**
   * Locates a paper's PDF from its stored record. The id alone is not enough: a paper can sit in any collection folder under papers/, and moves with it.
   * @returns URI of the paper's paper.pdf, or null when the id is unknown
   */
  async resolvePdfUri(paperId: string): Promise<vscode.Uri | null> {
    const paper = (await this.database.listPapers()).find((p) => p.id === paperId);
    // A paper saved without a PDF has no file to resolve, so the AI indexer and
    // other readers skip it silently instead of failing on a missing file.
    if (!paper || paper.hasPdf === false || !(await this._pdfExists(paper))) {
      return null;
    }
    return vscode.Uri.file(paperFiles(paper.path, path.join).pdf);
  }

  /**
   * Updates the read-status of one paper and emits PAPER_UPDATED; returns undefined if not found.
   * @returns updated PaperRecord or undefined
   */
  async updatePaperStatus(paperId: string, status: PaperRecord["status"]): Promise<PaperRecord | undefined> {
    return this.updatePaperFields(paperId, { status });
  }

  /**
   * Changes the fields the user owns (reading status, tags, note) in the index and in metadata.yaml, which the index is
   * rebuilt from on every activation, and emits PAPER_UPDATED. An unchanged patch writes nothing.
   * @returns updated PaperRecord, or undefined when the paper is unknown
   */
  async updatePaperFields(paperId: string, patch: PaperFieldsPatch): Promise<PaperRecord | undefined> {
    const current = await this._findPaper(paperId);
    if (!current) {
      return undefined;
    }
    const owned: Pick<PaperRecord, "tags" | "note"> = {};
    if (patch.tags !== undefined) { owned.tags = normalizeTags(patch.tags); }
    if (patch.note !== undefined) { owned.note = patch.note; }

    const next: PaperRecord = { ...current, ...(patch.status ? { status: patch.status } : {}), ...owned };
    const changed = next.status !== current.status
      || (owned.tags !== undefined && owned.tags.join("\n") !== (current.tags ?? []).join("\n"))
      || (owned.note !== undefined && owned.note !== (current.note ?? ""));
    if (!changed) {
      return current;
    }
    await this.database.upsertPaper(next);
    await this.writeArtifacts(next, owned, { ownsStatus: patch.status !== undefined });
    this.eventBus.emit(EVENTS.PAPER_UPDATED, next);
    return next;
  }

  /**
   * The BibTeX entry of a paper, as written to its folder but without the local `file` line.
   * @returns the entry text
   */
  bibtexFor(paper: PaperRecord): string {
    return this.bibTeXService.generateBibTeX(paper, { includeFile: false });
  }

  /**
   * Removes a paper from the index and optionally sends its folder to the trash; emits PAPER_DELETED.
   * @returns true if the paper existed and was deleted, false if not found
   */
  async deletePaper(paperId: string, deleteFiles: boolean): Promise<boolean> {
    const papers = await this.database.listPapers();
    const paper = papers.find((p) => p.id === paperId);
    if (!paper) {
      return false;
    }

    await this.database.deletePaper(paperId);

    if (deleteFiles) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(paper.path), { recursive: true, useTrash: true });
      } catch {
        // Files may already be missing; deletion from index is the critical step
      }
    }

    this.eventBus.emit(EVENTS.PAPER_DELETED, { id: paperId });
    return true;
  }

  /**
   * Imports multiple PDFs or folders of PDFs, collecting per-file successes, failures, and skipped paths.
   * A single import can take ten seconds or more (OCR, registry lookups), so
   * onProgress lets the caller show which file is being worked on.
   * @returns BatchImportResult with success, failed, and skipped arrays
   */
  async addPapersFromUris(
    uris: vscode.Uri[],
    targetParentDir?: vscode.Uri,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<BatchImportResult> {
    const result: BatchImportResult = { success: [], failed: [], skipped: [], needsReview: [] };
    const pdfs = await this._expandToPdfs(uris, result.skipped);
    for (const [position, pdfUri] of pdfs.entries()) {
      onProgress?.({ index: position + 1, total: pdfs.length, fileName: path.basename(pdfUri.fsPath) });
      try {
        const paper = await this.addPaperFromUri(pdfUri, targetParentDir);
        result.success.push(paper);
        if (this._lastImportNeedsReview) {
          result.needsReview?.push(paper);
        }
      } catch (error) {
        result.failed.push({
          path: pdfUri.fsPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  }

  // Expands a mix of file and directory URIs into a flat list of PDF URIs, populating skipped for non-PDFs.
  private async _expandToPdfs(uris: vscode.Uri[], skipped: string[]): Promise<vscode.Uri[]> {
    const pdfs: vscode.Uri[] = [];
    for (const uri of uris) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          pdfs.push(...await this._findPdfsInFolder(uri));
        } else if (uri.fsPath.toLowerCase().endsWith(".pdf")) {
          pdfs.push(uri);
        } else {
          skipped.push(uri.fsPath);
        }
      } catch {
        skipped.push(uri.fsPath);
      }
    }
    return pdfs;
  }

  // Recursively collects all PDF files inside a directory tree.
  private async _findPdfsInFolder(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
    const pdfs: vscode.Uri[] = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(folderUri);
      for (const [name, type] of entries) {
        const child = vscode.Uri.joinPath(folderUri, name);
        if (type === vscode.FileType.Directory) {
          pdfs.push(...await this._findPdfsInFolder(child));
        } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(".pdf")) {
          pdfs.push(child);
        }
      }
    } catch {
      // Folder unreadable — skip silently
    }
    return pdfs;
  }

  /**
   * Rewrites stored paper paths after a collection folder is renamed or moved so the index stays valid.
   * @returns void
   */
  async relocatePapersUnder(oldDir: string, newDir: string): Promise<void> {
    const { updated } = await this._folderService().relocatePapersUnder(oldDir, newDir);
    for (const paper of updated) {
      this.eventBus.emit(EVENTS.PAPER_UPDATED, paper);
    }
  }

  /**
   * Drops index entries for every paper stored under dirPath, emitting PAPER_DELETED for each.
   * @returns void
   */
  async removePapersUnder(dirPath: string): Promise<void> {
    const { removedIds } = await this._folderService().removePapersUnder(dirPath);
    for (const id of removedIds) {
      this.eventBus.emit(EVENTS.PAPER_DELETED, { id });
    }
  }

  /**
   * Moves paper folders into targetDir on disk and re-points their records; papers already there are skipped.
   * @returns the ids that moved and the per-paper failures (for example a name collision in the target)
   */
  async movePapers(paperIds: string[], targetDir: string): Promise<PaperMoveResult> {
    const byId = new Map((await this.database.listPapers()).map((p) => [p.id, p]));
    const result: PaperMoveResult = { moved: [], failed: [] };

    for (const id of paperIds) {
      const paper = byId.get(id);
      if (!paper) {
        result.failed.push({ id, error: "Paper not found" });
        continue;
      }
      if (path.dirname(paper.path) === targetDir) {
        continue;
      }
      const destination = path.join(targetDir, path.basename(paper.path));
      try {
        await vscode.workspace.fs.rename(vscode.Uri.file(paper.path), vscode.Uri.file(destination), { overwrite: false });
        await this.relocatePapersUnder(paper.path, destination);
        result.moved.push(id);
      } catch (error) {
        result.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }

  /**
   * Moves a collection folder into targetParentDir and re-points every paper stored under it.
   * @returns the folder's new absolute path
   */
  async moveFolder(dirPath: string, targetParentDir: string): Promise<string> {
    if (path.dirname(dirPath) === targetParentDir) {
      throw new Error("The folder is already there.");
    }
    if (isUnderDir(targetParentDir, dirPath, path.sep)) {
      throw new Error("A folder cannot be moved into itself.");
    }
    const destination = path.join(targetParentDir, path.basename(dirPath));
    await vscode.workspace.fs.rename(vscode.Uri.file(dirPath), vscode.Uri.file(destination), { overwrite: false });
    await this.relocatePapersUnder(dirPath, destination);
    return destination;
  }

  // FolderService is platform-agnostic; we instantiate per call so it always
  // sees the same database instance even if listPapers caches change.
  private _folderService(): FolderService {
    return new FolderService(this.database, path.sep);
  }

  /**
   * Re-writes the BibTeX and metadata artifacts for every paper in the library.
   * @returns count of papers processed
   */
  async regenerateBibTeX(): Promise<number> {
    const papers = await this.database.listPapers();
    for (const paper of papers) {
      await this.writeArtifacts(paper);
    }

    return papers.length;
  }
}

// The record of a PDF that was just copied into the library, so it always has one.
function importedPaperRecord(id: string, folderPath: string, parsed: ParsedPdfImport): PaperRecord {
  return {
    id,
    title: parsed.title,
    path: folderPath,
    citeKey: id,
    status: "unread",
    hasPdf: true,
    ...(parsed.authors?.length ? { authors: parsed.authors } : {}),
    ...(parsed.year ? { year: parsed.year } : {}),
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    ...(parsed.journal ? { journal: parsed.journal } : {}),
    ...(parsed.publisher ? { publisher: parsed.publisher } : {}),
    ...(parsed.volume ? { volume: parsed.volume } : {}),
    ...(parsed.issue ? { issue: parsed.issue } : {}),
    ...(parsed.pages ? { pages: parsed.pages } : {}),
    ...(parsed.doi ? { doi: parsed.doi } : {}),
    ...(parsed.url ? { url: parsed.url } : {}),
    ...(parsed.issn ? { issn: parsed.issn } : {}),
    ...(parsed.language ? { language: parsed.language } : {}),
    ...(parsed.keywords?.length ? { keywords: parsed.keywords } : {}),
  };
}

// Turns a text-layer job's outcome into the verdict shown in the library.
function verdictFor(outcome: TextLayerOutcome): TextLayerInfo {
  const checkedAt = now();
  switch (outcome.status) {
    case "added":
      return {
        state: "ocr",
        ocrPages: outcome.pagesAdded,
        ...(outcome.pagesFailed > 0 ? { failedPages: outcome.pagesFailed } : {}),
        checkedAt,
      };
    case "not-needed":
      return { state: outcome.layer, checkedAt };
    case "cancelled":
      return { state: "missing", reason: "OCR was cancelled", checkedAt };
    case "skipped":
      return { state: "missing", reason: outcome.reason, checkedAt };
    case "unavailable":
      return { state: "failed", reason: outcome.reason, checkedAt };
  }
}

// Re-checking a paper LabShelf read itself finds text — an OCR layer at best,
// native-looking text at worst — and knows less than the record does (how
// many pages were read). The record wins.
function keepsOcrDetail(current: TextLayerInfo | undefined, next: TextLayerInfo): boolean {
  return current?.state === "ocr" && (next.state === "ocr" || next.state === "native") && next.ocrPages === undefined;
}

function sameVerdict(a: TextLayerInfo | undefined, b: TextLayerInfo): boolean {
  return Boolean(a) && a!.state === b.state && a!.reason === b.reason
    && a!.ocrPages === b.ocrPages && a!.failedPages === b.failedPages;
}

function now(): string {
  return new Date().toISOString();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A record is worth reviewing when no registry confirmed it: the title and
// authors then come from the PDF's own layout or its filename.
function needsReview(parsed: ParsedPdfImport): boolean {
  return parsed.confidence !== "high" && !parsed.doi;
}
