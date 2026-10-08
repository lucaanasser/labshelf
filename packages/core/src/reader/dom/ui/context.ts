/**
 * Shared handles every reader UI module works against once the document is open.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs" with { "resolution-mode": "import" };
import type { ReaderBootParams, ReaderPrefs } from "../../index.js";
import type { HostBridge } from "./hostBridge.js";

export type PdfjsLib = typeof import("pdfjs-dist");
export type ViewerLib = typeof import("pdfjs-dist/web/pdf_viewer.mjs", { with: { "resolution-mode": "import" } });

export interface ReaderContext {
  boot: ReaderBootParams;
  host: HostBridge;
  pdfjsLib: PdfjsLib;
  viewerLib: ViewerLib;
  pdfDocument: PDFDocumentProxy;
  pdfViewer: PDFViewer;
  eventBus: EventBus;
  linkService: PDFLinkService;
  findController: PDFFindController;
  /** Snapshot of the scroll position taken right before a find command, so an already-visible hit does not move the page. */
  markFindOrigin(): void;
  container: HTMLDivElement;
  /** Live preferences; replaced in place on `prefsChanged`. */
  prefs: ReaderPrefs;
}

/** Location payload of pdf.js' `updateviewarea` event. */
export interface PdfLocation {
  pageNumber: number;
  scale: number | string;
  left: number;
  top: number;
  rotation?: number;
  pdfOpenParams?: string;
}
