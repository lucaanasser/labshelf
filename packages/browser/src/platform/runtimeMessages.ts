/**
 * Discriminated message types exchanged between background and UI surfaces
 * (popup, options, library-page, the Google Scholar content script).
 * Centralised so every send/receive site is type-checked against the same
 * envelope.
 * @depends none.
 * @dependents background/index, popup, options, library-page, content/scholar.
 */

/** What a save does when the resolver chain found no PDF. A missing field means "ask". */
export type IfNoPdf = "ask" | "save";

export type RuntimeMessage =
  | { type: "ping" }
  | { type: "auth.status" }
  | { type: "auth.connect" }
  | { type: "auth.disconnect" }
  | { type: "sync.now" }
  | { type: "sync.status" }
  | { type: "sync.scheduleSoon"; reason: string }
  /** Reads the paper shown in a tab (the popup's first call). */
  | { type: "capture.inspect"; tabId: number }
  /** Waits for the PDF search the inspect started; the popup shows the result. */
  | { type: "capture.findPdf"; tabId: number }
  /** Saves the inspected paper into `folder` with the user's tags and note. */
  | { type: "capture.save"; tabId: number; folder?: string; tags?: string[]; note?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Inspects and saves a tab in one go (the library page's "Add from open tab"). */
  | { type: "capture.tab"; tabId: number; targetFolder?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Saves one Google Scholar result. */
  | { type: "scholar.save"; hit: ScholarHit; folder?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Popup, paper already in the library without a PDF: attach the PDF found for this tab to that copy. */
  | { type: "capture.attachPdf"; tabId: number }
  /** Library page "Find PDF": run the resolver chain for a saved paper and attach what it finds. */
  | { type: "paper.findPdf"; id: string }
  /** Removes a paper just saved (the popup's undo). */
  | { type: "paper.remove"; id: string }
  /** Collections a paper can be saved into, plus the last one used. */
  | { type: "library.folders" }
  /** Which of these papers the library already holds, by key. */
  | { type: "library.lookup"; items: LookupItem[] }
  /** Opens the library page on a collection, optionally selecting a paper. */
  | { type: "library.open"; folder?: string; paperId?: string }
  /** Lists the current window's http(s) tabs, excluding extension pages. */
  | { type: "tabs.list" };

export type RuntimeResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export interface SyncStatusData {
  connected: boolean;
  syncing: boolean;
  lastSyncTime: string | null;
  lastError: string | null;
}

/** How a PDF search that found nothing went; feeds every "No PDF found" dialog. */
export interface PdfMiss {
  /** Distinct candidate URLs downloaded and rejected (helper-tab retries not double-counted). */
  tried: number;
  /** Resolver labels consulted, de-duplicated, chain order: page | scholar | arxiv | publisher | crossref | unpaywall | sci-hub. */
  sources: string[];
  /** At least one candidate answered with a bot check the helper tab could not pass. */
  blocked: boolean;
}

/** The library's copy of a paper. */
export interface LibraryRef {
  id: string;
  path: string;
  /** Collection holding it. */
  folder: string;
  /** `<path>/paper.pdf` exists in the IndexedDB files store. Required, so the compiler finds every producer. */
  hasPdf: boolean;
}

/** What the popup shows about the tab before saving. */
export interface DraftView {
  isPaper: boolean;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  /** registry | search | page | none — how sure the record is. */
  origin: string;
  existing?: LibraryRef;
}

export interface PdfStatusData {
  found: boolean;
  /** Who supplied it: page, scholar, publisher, arxiv, crossref, unpaywall, sci-hub. */
  source?: string;
  /** Present when found is false: lets the popup open the dialog instantly, with no round trip. */
  miss?: PdfMiss;
}

export interface SavedPaperData extends LibraryRef {
  status: "saved";
  title: string;
  citeKey: string;
  /** Resolver that supplied the PDF, or null when the paper was saved without one. */
  pdfSource: string | null;
  /** True when nothing was written because the library already had it. */
  alreadyInLibrary?: boolean;
}

/** A save sent with ifNoPdf "ask" found no PDF: NOTHING was written. Re-send with ifNoPdf "save" to confirm. */
export interface NoPdfData {
  status: "no-pdf";
  title: string;
  /** The article's landing page, when known (a dialog may offer "Open the article page"). */
  pageUrl?: string;
  miss: PdfMiss;
}

/** Reply to capture.save, capture.tab and scholar.save. */
export type SaveOutcome = SavedPaperData | NoPdfData;

/** Reply to capture.attachPdf and paper.findPdf. */
export interface AttachPdfData {
  id: string;
  /** paper.pdf was written now. */
  attached: boolean;
  source?: string;
  /** Nothing written because a PDF was already there (e.g. it arrived by sync meanwhile). */
  alreadyHadPdf?: boolean;
  /** Present when nothing was found. */
  miss?: PdfMiss;
}

/**
 * Background -> extension pages after it changed the library. Kept OUT of
 * RuntimeMessage, because background/index forces every RuntimeMessage to be
 * handled and this broadcast is not a request.
 */
export interface LibraryChangedBroadcast {
  type: "library.changed";
  reason: "capture" | "attach" | "remove" | "sync";
  paperId?: string;
}

export interface FolderOption {
  path: string;
  /** Folder name ("Library" for the root). */
  label: string;
  /** 0 for the root, 1 for its children, … */
  depth: number;
}

export interface FoldersData {
  folders: FolderOption[];
  lastFolder: string;
}

export interface LookupItem {
  key: string;
  doi?: string;
  arxivId?: string;
  title?: string;
  year?: number;
}

export type LookupData = Record<string, LibraryRef>;

/** One Google Scholar result, as the content script reads it. */
export interface ScholarHit {
  /** Scholar's cluster id (data-cid). */
  key: string;
  title: string;
  /** The title link — the article's landing page. */
  url?: string;
  /** The "[PDF]" link in the right column. */
  pdfUrl?: string;
  /** As printed: abbreviated, possibly truncated. */
  authors: string[];
  venue?: string;
  year?: number;
}

export interface TabSummary {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export const RUNTIME_CHANNEL = "labshelf.runtime";
