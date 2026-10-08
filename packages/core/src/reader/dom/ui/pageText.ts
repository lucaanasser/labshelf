/**
 * Lazy, cached text extraction per page: reading-order lines plus the column split. Shared by the citation and float
 * resolvers so a page is extracted and analysed once.
 */
import { detectColumns, groupItemsIntoLines, readableItems, runOrientation, type TextItemBox, type TextLine } from "../../logic/index.js";
import type { ReaderContext } from "./context.js";

export interface PageText {
  lines: TextLine[];
  columnSplit: number | null;
  width: number;
  height: number;
}

export class PageTextCache {
  private readonly pages = new Map<number, Promise<PageText>>();

  constructor(private readonly ctx: ReaderContext) {}

  get numPages(): number { return this.ctx.pdfDocument.numPages; }

  /**
   * @returns the page's text lines in reading order; extraction runs once per page.
   */
  get(pageNumber: number): Promise<PageText> {
    let promise = this.pages.get(pageNumber);
    if (!promise) {
      promise = this.extract(pageNumber);
      this.pages.set(pageNumber, promise);
    }
    return promise;
  }

  private async extract(pageNumber: number): Promise<PageText> {
    const page = await this.ctx.pdfDocument.getPage(pageNumber);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const all: TextItemBox[] = [];
    for (const raw of content.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
      if (typeof it.str !== "string" || !it.transform) { continue; }
      all.push({
        str: it.str,
        x: it.transform[4] ?? 0,
        y: it.transform[5] ?? 0,
        width: it.width ?? 0,
        height: it.height || Math.abs(it.transform[3] ?? 0) || 10,
        orientation: runOrientation(it.transform),
      });
    }
    const items = readableItems(all, width);
    return { lines: groupItemsIntoLines(items, width), columnSplit: detectColumns(items, width), width, height };
  }
}
