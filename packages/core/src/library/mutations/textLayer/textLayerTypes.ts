/** What a text-layer check or OCR job reports about a PDF, before it becomes the verdict stored on the paper. */

/** Where the text of a PDF that has some comes from. */
export type ExistingLayer = "native" | "ocr";

export type TextLayerOutcome =
  // The document carries a text layer on `pagesAdded` pages.
  | { status: "added"; bytes: Uint8Array; pagesAdded: number; pagesFailed: number }
  // The PDF already has text: its own, or an OCR layer added earlier.
  | { status: "not-needed"; layer: ExistingLayer }
  | { status: "cancelled" }
  // The document needs OCR but was deliberately not read (OCR off, too many pages).
  | { status: "skipped"; reason: string }
  // OCR could not run or produced nothing usable; `reason` says why.
  | { status: "unavailable"; reason: string };

/** What a document's own text layer looks like, before any OCR. */
export type TextLayerDetection =
  | { status: ExistingLayer }
  | { status: "missing"; textlessPages: number; totalPages: number }
  | { status: "unavailable"; reason: string };
