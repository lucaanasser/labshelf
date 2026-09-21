/**
 * Makes a scanned PDF selectable and searchable. Every page without a text
 * layer is read optically, and Tesseract's invisible, positioned text is laid
 * over the original page. The page's own content is never re-encoded, so the
 * paper looks exactly as it did and grows by a few kilobytes per page.
 *
 * @depends pdf-lib, @labshelf/core, pdf/tesseractOcrEngine.ts
 * @dependents core/paperService.ts (injected), extension.ts
 */
import { isSparseText } from "@labshelf/core";

import { openPdfForOcr, type OcrDocument, type TesseractOcrEngine } from "./tesseractOcrEngine.js";

export interface TextLayerProgress {
  // 1-based position among the pages being read, not the page number.
  index: number;
  total: number;
  pageNumber: number;
}

export interface TextLayerHooks {
  onProgress?: (progress: TextLayerProgress) => void;
  isCancelled?: () => boolean;
}

export type TextLayerOutcome =
  // The document now carries a text layer on `pagesAdded` pages.
  | { status: "added"; bytes: Uint8Array; pagesAdded: number; pagesFailed: number }
  // Every page already has text; nothing to do.
  | { status: "not-needed" }
  | { status: "cancelled" }
  // OCR could not run or produced nothing usable; `reason` says why.
  | { status: "unavailable"; reason: string };

/** Adds a text layer to PDFs that lack one. */
export interface PdfTextLayerBuilder {
  build(pdfBytes: Uint8Array, hooks?: TextLayerHooks): Promise<TextLayerOutcome>;
}

export interface SearchablePdfOptions {
  // Reading a page takes seconds; a scanned book would hold the OCR worker for an hour.
  maxPages?: number | undefined;
}

const DEFAULT_MAX_PAGES = 150;
const MIN_TEXTLESS_SHARE = 0.5;

export class SearchablePdfBuilder implements PdfTextLayerBuilder {
  constructor(
    private readonly engine: TesseractOcrEngine,
    private readonly options: SearchablePdfOptions = {},
  ) {}

  /**
   * Reads every text-less page and returns the PDF with the text laid over it.
   * @usedBy core/paperService.ts
   * @returns The outcome; bytes are present only when a layer was actually added.
   */
  async build(pdfBytes: Uint8Array, hooks: TextLayerHooks = {}): Promise<TextLayerOutcome> {
    const source = await openPdfForOcr(pdfBytes);
    if (!source) {
      return { status: "unavailable", reason: "no native canvas build is installed for this platform" };
    }

    try {
      const pages = await pagesWithoutText(source);
      // A born-digital paper has the odd page that is all figure. Reading those
      // would stack a second copy of the caption over the real one; a scan is
      // text-less throughout, which is what tells the two apart.
      if (pages.length === 0 || pages.length < source.numPages * MIN_TEXTLESS_SHARE) {
        return { status: "not-needed" };
      }
      const maxPages = this.options.maxPages ?? DEFAULT_MAX_PAGES;
      if (pages.length > maxPages) {
        return { status: "unavailable", reason: `${pages.length} pages need OCR, above the limit of ${maxPages}` };
      }
      return await this.addLayers(pdfBytes, source, pages, hooks);
    } finally {
      await source.close();
    }
  }

  private async addLayers(
    pdfBytes: Uint8Array,
    source: OcrDocument,
    pages: number[],
    hooks: TextLayerHooks,
  ): Promise<TextLayerOutcome> {
    const { PDFDocument } = await import("pdf-lib");
    let target: Awaited<ReturnType<typeof PDFDocument.load>>;
    try {
      target = await PDFDocument.load(pdfBytes);
    } catch (error) {
      // Encrypted or structurally unusual files: leave the paper untouched.
      return { status: "unavailable", reason: `the PDF cannot be rewritten (${describe(error)})` };
    }
    if (target.getPageCount() !== source.numPages) {
      return { status: "unavailable", reason: "page count differs between the reader and the writer" };
    }

    let pagesAdded = 0;
    let pagesFailed = 0;
    for (const [position, pageNumber] of pages.entries()) {
      if (hooks.isCancelled?.()) {
        return { status: "cancelled" };
      }
      hooks.onProgress?.({ index: position + 1, total: pages.length, pageNumber });

      try {
        // A rotated page renders upright while its boxes stay unrotated, so the
        // layer would land sideways. Rare in papers; skipped rather than guessed.
        if ((await source.rotation(pageNumber)) % 360 !== 0) {
          pagesFailed += 1;
          continue;
        }
        const layer = await this.engine.recognizeTextLayer(await source.renderPng(pageNumber));
        if (!layer) {
          // A figure or a blank page: nothing to add, and not a failure.
          continue;
        }

        const [embedded] = await target.embedPdf(layer, [0]);
        const page = target.getPage(pageNumber - 1);
        // pdfjs rendered the crop box, so that is the area the layer describes.
        const box = page.getCropBox();
        page.drawPage(embedded!, { x: box.x, y: box.y, width: box.width, height: box.height });
        pagesAdded += 1;
      } catch (error) {
        pagesFailed += 1;
        this.engine.report(`Text layer failed on page ${pageNumber}: ${describe(error)}`);
      }
    }

    if (pagesAdded === 0) {
      return { status: "unavailable", reason: "OCR found no text on any page" };
    }

    const bytes = await target.save();
    // The file replaces the user's paper, so it is proven readable first.
    if (!(await hasTextOn(bytes, pages, source.numPages))) {
      return { status: "unavailable", reason: "the rewritten PDF did not pass verification" };
    }
    return { status: "added", bytes, pagesAdded, pagesFailed };
  }
}

// A page counts as text-less by the same measure the importer uses, so a
// download stamp or print header does not pass for a text layer.
async function pagesWithoutText(document: OcrDocument): Promise<number[]> {
  const pages: number[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const text = await document.pageText(pageNumber).catch(() => "");
    if (isSparseText([text])) {
      pages.push(pageNumber);
    }
  }
  return pages;
}

// Re-opens the result and confirms it still has every page and that at least
// one of the pages that were read now carries real text.
async function hasTextOn(bytes: Uint8Array, pages: number[], expectedPages: number): Promise<boolean> {
  const reopened = await openPdfForOcr(bytes).catch(() => undefined);
  if (!reopened) {
    return false;
  }
  try {
    if (reopened.numPages !== expectedPages) {
      return false;
    }
    const stillEmpty = await pagesWithoutText(reopened);
    return pages.some((pageNumber) => !stillEmpty.includes(pageNumber));
  } finally {
    await reopened.close();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
