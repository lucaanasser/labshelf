/**
 * Finds the figure, table or equation a textual reference ("Fig. 3", "Tabela 2", "Eq. (5)") points at, from captions in
 * the page text. This is what makes float previews work in PDFs without link annotations, scans with an OCR layer included.
 *
 * @depends webview/logic/captions.ts, webview/ui/pageText.ts
 * @dependents webview/ui/hoverPreview.ts, webview/reader.ts
 */
import { findCaptionLines, floatRegion, pickCaption, type PdfRegion } from "../logic/captions.js";
import type { FloatKind } from "../logic/inTextRefs.js";
import type { PageTextCache } from "./pageText.js";

export interface FloatTarget {
  pageNumber: number;
  region: PdfRegion;
  /** Baseline of the caption line, for jumping. */
  captionY: number;
}

interface IndexedCaption {
  kind: FloatKind;
  label: string;
  pageNumber: number;
  lineIndex: number;
}

// A monograph has thousands of lines; past this the index costs more than a float preview is worth.
const MAX_INDEXED_PAGES = 150;

export class FloatResolver {
  private index: Promise<IndexedCaption[]> | null = null;

  constructor(private readonly pages: PageTextCache) {}

  /**
   * Builds the caption index in the background so the first hover does not pay for it.
   * @usedBy webview/reader.ts
   * @returns void
   */
  warmUp(): void {
    void this.getIndex();
  }

  /**
   * @usedBy webview/ui/hoverPreview.ts
   * @returns where the float is, or null when no caption with that label exists.
   */
  async find(kind: FloatKind, label: string): Promise<FloatTarget | null> {
    const index = await this.getIndex();
    const at = pickCaption(index, kind, label);
    const hit = index[at];
    if (!hit) { return null; }
    const page = await this.pages.get(hit.pageNumber);
    const line = page.lines[hit.lineIndex];
    if (!line) { return null; }
    return {
      pageNumber: hit.pageNumber,
      region: floatRegion(page.lines, hit, page.width, page.height, page.columnSplit),
      captionY: line.y + line.height,
    };
  }

  private getIndex(): Promise<IndexedCaption[]> {
    this.index ??= this.build();
    return this.index;
  }

  private async build(): Promise<IndexedCaption[]> {
    const out: IndexedCaption[] = [];
    const last = Math.min(this.pages.numPages, MAX_INDEXED_PAGES);
    for (let pageNumber = 1; pageNumber <= last; pageNumber++) {
      try {
        const page = await this.pages.get(pageNumber);
        for (const hit of findCaptionLines(page.lines, page.width, page.columnSplit)) {
          // The first caption with a label wins: later "Figure 3" lines are continuations ("Figure 3 (continued)").
          if (!out.some((c) => c.kind === hit.kind && c.label === hit.label)) { out.push({ ...hit, pageNumber }); }
        }
      } catch {
        // A page whose text cannot be extracted simply contributes no captions.
      }
      // Yield between pages: this runs while the reader is reading.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    }
    return out;
  }
}
