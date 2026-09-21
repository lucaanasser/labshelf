/**
 * Loads pdf.js and the paper's bytes as fast as the webview allows, and records the open timeline.
 *
 * @depends pdf-viewer/shared/protocol.ts, pdf-viewer/webview/ui/context.ts (types only), pdfjs-dist (runtime, by dynamic import of webview URIs)
 * @dependents pdf-viewer/webview/main.ts
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PerfTimeline, ReaderAssets } from "../../shared/protocol.js";
import type { PdfjsLib, ViewerLib } from "./context.js";

export interface LoadedPdf {
  pdfjsLib: PdfjsLib;
  viewerLib: ViewerLib;
  pdfDocument: PDFDocumentProxy;
}

export class PerfMarks {
  readonly timeline: PerfTimeline = { scriptStart: Math.round(performance.now()) };

  /**
   * Records the current time under `name`.
   * @usedBy pdf-viewer/webview/main.ts, pdf-viewer/webview/ui/pdfLoader.ts (loadPdf)
   * @returns void
   */
  mark(name: string): void { this.timeline[name] = Math.round(performance.now()); }

  /**
   * Records an explicit value under `name` (e.g. a byte count, not a timestamp).
   * @usedBy pdf-viewer/webview/ui/pdfLoader.ts (loadPdf)
   * @returns void
   */
  set(name: string, value: number): void { this.timeline[name] = value; }
}

/**
 * @usedBy pdf-viewer/webview/main.ts
 * @returns the pdf.js libraries and the opened document.
 */
export async function loadPdf(assets: ReaderAssets, perf: PerfMarks): Promise<LoadedPdf> {
  if (!assets.pdfjsUrl || !assets.viewerUrl) { throw new Error("PDF.js viewer assets are unavailable."); }

  // Kick off every download at t=0 so the PDF bytes and the worker source
  // arrive while pdf.js is still being fetched and compiled. The webview host
  // serves neither Accept-Ranges nor Content-Length, so pdf.js would stream
  // the whole file anyway — only later, after the imports had finished.
  const pdfBytesPromise = fetch(assets.pdfUrl).then((r) => {
    if (!r.ok) { throw new Error(`Could not read paper.pdf (HTTP ${r.status}).`); }
    return r.arrayBuffer();
  }).then((buf) => {
    perf.mark("pdfFetched");
    perf.set("pdfBytes", buf.byteLength);
    return buf;
  });
  pdfBytesPromise.catch(() => { /* surfaced by the await below */ });
  const workerSrcPromise: Promise<string | null> = assets.workerUrl
    ? fetch(assets.workerUrl).then((r) => r.text())
    : Promise.resolve(null);
  workerSrcPromise.catch(() => { /* surfaced by the await below */ });

  const pdfjsLib = (await import(assets.pdfjsUrl)) as PdfjsLib;
  perf.mark("pdfjsImported");
  // pdf_viewer.mjs reads the core library from this global.
  (globalThis as { pdfjsLib?: PdfjsLib }).pdfjsLib = pdfjsLib;

  // Boot the worker as soon as its source lands instead of after the viewer import.
  // A webview URI cannot be a module worker directly, hence the Blob URL.
  const workerReady = workerSrcPromise.then((workerSrc) => {
    if (!workerSrc) { return; }
    const workerBlob = new Blob([workerSrc], { type: "text/javascript" });
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(workerBlob), { type: "module" });
    perf.mark("workerStarted");
  });

  const [viewerLib, pdfBytes] = await Promise.all([
    import(assets.viewerUrl) as Promise<ViewerLib>,
    pdfBytesPromise,
    workerReady,
  ]);
  perf.mark("viewerImported");

  // pdf.js would otherwise fetch cmaps, standard fonts, wasm decoders and ICC
  // profiles from inside its worker. VS Code's webview service worker cannot
  // tie a worker request to a webview, never forwards it to the host, and the
  // request dies after its 30 s timeout — stalling the first page for 30 s on
  // any PDF that needs one of those assets. Fetching from the page works.
  const params: Record<string, unknown> = {
    data: pdfBytes,
    useWorkerFetch: false,
    cMapPacked: true,
    useSystemFonts: true,
    isEvalSupported: true,
    enableHWA: true,
  };
  if (assets.cMapUrl) { params["cMapUrl"] = assets.cMapUrl; }
  if (assets.stdFontUrl) { params["standardFontDataUrl"] = assets.stdFontUrl; }
  if (assets.wasmUrl) { params["wasmUrl"] = assets.wasmUrl; }
  if (assets.iccUrl) { params["iccUrl"] = assets.iccUrl; }
  const pdfDocument = await pdfjsLib.getDocument(params).promise;
  perf.mark("docLoaded");

  return { pdfjsLib, viewerLib, pdfDocument };
}

/**
 * An empty paper.pdf means the stored copy is unusable, not that rendering failed — tell the reader how to fix it instead of surfacing pdfjs' wording.
 * @usedBy pdf-viewer/webview/main.ts
 * @returns a user-facing error message.
 */
export function describeLoadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return /empty|zero bytes/i.test(msg)
    ? "This paper's stored PDF is empty (0 bytes), so there is nothing to display. Re-add the paper to the library to restore the file."
    : `Failed to initialize PDF viewer: ${msg}`;
}
