/**
 * Recovers text from PDFs whose text layer cannot be read — scans, and files
 * whose embedded fonts carry a broken character map. Renders the page with
 * pdfjs onto a native canvas and reads it with Tesseract.
 *
 * Both dependencies are loaded lazily and their absence is non-fatal: a build
 * without them simply falls back to whatever the text layer provided.
 *
 * @depends pdfjs-dist, tesseract.js, @labshelf/core, pdf/pdfjsNodeEnvironment.ts
 * @dependents extension.ts
 */
import type { PdfOcrEngine } from "@labshelf/core";

import { loadPdfjs } from "./nodePdfOpener.js";
import { loadPdfCanvas, nodeRenderOptions } from "./pdfjsNodeEnvironment.js";

// Tesseract wants roughly 300 DPI; PDF user space is 72 DPI.
const RENDER_SCALE = 300 / 72;
// Guards against a pathological page size exhausting memory.
const MAX_RENDER_PIXELS = 40_000_000;

export interface TesseractOcrOptions {
  // Where Tesseract caches its downloaded language data between sessions.
  cachePath?: string | undefined;
  languages?: string[] | undefined;
  // Receives one-line diagnostics; OCR problems never fail an import.
  onDiagnostic?: ((message: string) => void) | undefined;
}

export class TesseractOcrEngine implements PdfOcrEngine {
  private worker: TesseractWorker | undefined;
  private workerPromise: Promise<TesseractWorker | undefined> | undefined;

  constructor(private readonly options: TesseractOcrOptions = {}) {}

  /**
   * Renders the given pages and returns their recognized text.
   * @usedBy @labshelf/core PdfImportParser (injected)
   * @returns Newline-joined page text, or an empty string when OCR is unavailable.
   */
  async recognize(pdfBytes: Uint8Array, pageNumbers: number[]): Promise<string> {
    const worker = await this.ensureWorker();
    if (!worker) {
      return "";
    }
    if (!loadPdfCanvas()) {
      this.options.onDiagnostic?.("OCR unavailable: no native canvas build is installed for this platform");
      return "";
    }

    const document = await openPdfForOcr(pdfBytes);
    if (!document) {
      return "";
    }

    const chunks: string[] = [];
    try {
      for (const pageNumber of pageNumbers) {
        if (pageNumber > document.numPages) {
          continue;
        }
        try {
          const result = await worker.recognize(await document.renderPng(pageNumber));
          const text = result?.data?.text?.trim();
          if (text) {
            chunks.push(text);
          }
        } catch (error) {
          this.options.onDiagnostic?.(`OCR failed on page ${pageNumber}: ${describe(error)}`);
        }
      }
    } finally {
      await document.close();
    }
    return chunks.join("\n");
  }

  /**
   * Reads one page image and returns Tesseract's own text-only PDF for it: a
   * page the size of the image holding nothing but invisible, positioned text.
   * Laid over the original page it makes a scan selectable and searchable.
   * @usedBy pdf/searchablePdfBuilder.ts
   * @returns The layer's PDF bytes, or undefined when OCR is unavailable or found no text.
   */
  async recognizeTextLayer(image: Buffer): Promise<Uint8Array | undefined> {
    const worker = await this.ensureWorker();
    if (!worker) {
      return undefined;
    }
    const result = await worker.recognize(image, { pdfTextOnly: true, pdfTitle: "LabShelf OCR" }, { pdf: true, text: true });
    const pdf = result?.data?.pdf;
    return pdf && result.data?.text?.trim() ? new Uint8Array(pdf) : undefined;
  }

  /**
   * Reports a one-line diagnostic through the engine's channel, so everything
   * OCR-related lands in the same log module.
   * @usedBy pdf/searchablePdfBuilder.ts
   * @returns void
   */
  report(message: string): void {
    this.options.onDiagnostic?.(message);
  }

  /**
   * Shuts the Tesseract worker down. Safe to call when none was started.
   * @usedBy extension.ts (deactivate)
   * @returns void
   */
  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.workerPromise = undefined;
    await worker?.terminate().catch(() => undefined);
  }

  // One worker is created on first use and reused; spinning one up costs
  // seconds and downloads language data.
  private async ensureWorker(): Promise<TesseractWorker | undefined> {
    this.workerPromise ??= this.createWorker();
    return this.workerPromise;
  }

  private async createWorker(): Promise<TesseractWorker | undefined> {
    try {
      const tesseract = (await import("tesseract.js")) as unknown as {
        createWorker: (
          langs: string | string[],
          oem?: number,
          options?: Record<string, unknown>,
        ) => Promise<TesseractWorker>;
      };
      const languages = this.options.languages?.length ? this.options.languages : ["eng"];
      const workerOptions: Record<string, unknown> = {};
      if (this.options.cachePath) {
        workerOptions["cachePath"] = this.options.cachePath;
      }

      this.options.onDiagnostic?.(`Starting OCR worker (${languages.join("+")})`);
      this.worker = await tesseract.createWorker(languages, undefined, workerOptions);
      return this.worker;
    } catch (error) {
      this.options.onDiagnostic?.(`OCR unavailable: ${describe(error)}`);
      return undefined;
    }
  }
}

interface TesseractWorker {
  recognize(
    image: Buffer | Uint8Array,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data?: { text?: string; pdf?: number[] | null } }>;
  terminate(): Promise<unknown>;
}

/** A PDF opened for optical reading; close() must be called when done. */
export interface OcrDocument {
  numPages: number;
  // The page's existing text layer, empty for a scan.
  pageText(pageNumber: number): Promise<string>;
  // The page's /Rotate angle; a rotated page renders upright, unlike its media box.
  rotation(pageNumber: number): Promise<number>;
  // Share of the page's text runs drawn invisibly (render mode 3 or 7), which
  // is how every OCR tool lays its text over a scan; undefined when no text.
  invisibleTextShare(pageNumber: number): Promise<number | undefined>;
  renderPng(pageNumber: number): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Opens a PDF for rendering onto the native canvas.
 * @usedBy pdf/tesseractOcrEngine.ts, pdf/searchablePdfBuilder.ts
 * @returns The document handle, or undefined when no native canvas is installed.
 */
export async function openPdfForOcr(pdfBytes: Uint8Array): Promise<OcrDocument | undefined> {
  const canvasPkg = loadPdfCanvas();
  if (!canvasPkg) {
    return undefined;
  }

  // Not a bare import: in the extension host pdfjs needs its worker registered
  // first, and a check at startup can run before anything else opened a PDF.
  const pdfjs = await loadPdfjs();
  const getDocument = pdfjs["getDocument"] as (opts: Record<string, unknown>) => {
    promise: Promise<PdfRenderDocument>;
    destroy(): Promise<void>;
  };
  // The extension host is not recognised as Node by pdfjs, which would then
  // reach for a DOM canvas; the render options pin the native one instead.
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes), ...nodeRenderOptions(canvasPkg) });
  const document = await loadingTask.promise;

  return {
    numPages: document.numPages,
    async pageText(pageNumber) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      return content.items.map((item) => item.str ?? "").join(" ");
    },
    async rotation(pageNumber) {
      return (await document.getPage(pageNumber)).rotate ?? 0;
    },
    async invisibleTextShare(pageNumber) {
      const ops = await (await document.getPage(pageNumber)).getOperatorList();
      return invisibleShare(ops, pdfjs["OPS"] as Record<string, number>);
    },
    async renderPng(pageNumber) {
      const page = await document.getPage(pageNumber);
      const viewport = scaledViewport(page);
      const canvas = canvasPkg.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      // Tesseract reads dark-on-light best, and PDF pages assume a white sheet.
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      return canvas.toBuffer("image/png");
    },
    async close() {
      // The loading task owns teardown; pdfjs 6 has no PDFDocumentProxy.destroy().
      await loadingTask.destroy().catch(() => undefined);
    },
  };
}

function scaledViewport(page: PdfRenderPage): PdfViewport {
  const scaled = page.getViewport({ scale: RENDER_SCALE });
  const pixels = scaled.width * scaled.height;
  if (pixels <= MAX_RENDER_PIXELS) {
    return scaled;
  }
  return page.getViewport({ scale: RENDER_SCALE * Math.sqrt(MAX_RENDER_PIXELS / pixels) });
}

interface OperatorList {
  fnArray: number[];
  argsArray: unknown[][];
}

// Text render modes that paint nothing: 3 is invisible, 7 adds to the clip only.
const INVISIBLE_MODES = new Set([3, 7]);

/**
 * Counts which share of a page's text-showing operators run in an invisible
 * render mode. The mode is graphics state, so it follows save/restore.
 * @usedBy pdf/tesseractOcrEngine.ts
 * @returns A fraction from 0 to 1, or undefined when the page shows no text.
 */
export function invisibleShare(ops: OperatorList, OPS: Record<string, number>): number | undefined {
  const showText = new Set([OPS["showText"], OPS["showSpacedText"], OPS["nextLineShowText"], OPS["nextLineSetSpacingShowText"]]);
  const saved: number[] = [];
  let mode = 0;
  let runs = 0;
  let invisible = 0;
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    if (fn === OPS["save"]) {
      saved.push(mode);
    } else if (fn === OPS["restore"]) {
      mode = saved.pop() ?? 0;
    } else if (fn === OPS["setTextRenderingMode"]) {
      mode = Number(ops.argsArray[i]?.[0] ?? 0);
    } else if (showText.has(fn)) {
      runs += 1;
      if (INVISIBLE_MODES.has(mode)) {
        invisible += 1;
      }
    }
  }
  return runs === 0 ? undefined : invisible / runs;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfRenderPage {
  rotate?: number;
  getOperatorList(): Promise<OperatorList>;
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
  getViewport(options: { scale: number }): PdfViewport;
  render(options: Record<string, unknown>): { promise: Promise<void> };
}

interface PdfRenderDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfRenderPage>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
