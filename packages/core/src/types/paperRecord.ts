/**
 * Domain types describing a paper record and its reading status.
 *
 * @depends none
 * @dependents types/batchImport.ts, interfaces/database.ts, @labshelf/vscode, @labshelf/browser
 */
export type PaperStatus = "unread" | "reading" | "done";

/**
 * Whether a paper's PDF carries text that can be searched and selected:
 * native — the PDF was born digital; ocr — LabShelf read the scan and laid
 * invisible text over it; missing — a scan nobody has read yet (OCR off,
 * cancelled, over the page limit); failed — OCR was tried and did not work.
 */
export type TextLayerState = "native" | "ocr" | "missing" | "failed";

export interface TextLayerInfo {
  state: TextLayerState;
  // ocr: pages that received text, and pages that could not be read.
  ocrPages?: number;
  failedPages?: number;
  // missing / failed: why there is no text, in words a user can act on.
  reason?: string;
  // ISO timestamp of the check that produced this verdict.
  checkedAt: string;
}

const TEXT_LAYER_STATES: readonly string[] = ["native", "ocr", "missing", "failed"];

/**
 * Validates a text-layer verdict read from disk or a database column, which
 * may come from an older version or a hand-edited file.
 * @usedBy @labshelf/vscode libraryIndexer, sqliteResearchDatabase
 * @returns The verdict, or undefined when the value is not a usable one.
 */
export function parseTextLayerInfo(value: unknown): TextLayerInfo | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw["state"] !== "string" || !TEXT_LAYER_STATES.includes(raw["state"])) {
    return undefined;
  }
  const count = (key: string): number | undefined =>
    typeof raw[key] === "number" && Number.isInteger(raw[key]) && (raw[key] as number) >= 0 ? (raw[key] as number) : undefined;
  const ocrPages = count("ocrPages");
  const failedPages = count("failedPages");
  return {
    state: raw["state"] as TextLayerState,
    checkedAt: typeof raw["checkedAt"] === "string" ? raw["checkedAt"] : "",
    ...(ocrPages !== undefined ? { ocrPages } : {}),
    ...(failedPages !== undefined ? { failedPages } : {}),
    ...(typeof raw["reason"] === "string" && raw["reason"] ? { reason: raw["reason"] } : {}),
  };
}

export interface PaperRecord {
  id: string;
  title: string;
  authors?: string[];
  year?: number;
  path: string;
  citeKey: string;
  status: PaperStatus;
  summary?: string;
  // Bibliographic metadata populated via CrossRef / arXiv when a DOI/ID is found
  journal?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  issn?: string;
  language?: string;
  // Author or publisher supplied subject terms, when the PDF or a registry states them.
  keywords?: string[];
  // Absent until the PDF has been checked (papers imported before this existed).
  textLayer?: TextLayerInfo;
  // The user's own labels and comment, set when saving from the browser.
  // Undefined means "not known here": a rewrite keeps whatever the sidecar has.
  tags?: string[];
  note?: string;
  // True when <folder>/paper.pdf exists on this device. Derived by each surface
  // (VS Code indexer, browser file keys), never written to metadata.yaml.
  // Undefined = unknown, treated as present.
  hasPdf?: boolean;
}
