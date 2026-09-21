/**
 * Locates the References section and extracts the entry a citation link points at. Text extraction and layout analysis are lazy and cached per page.
 *
 * @depends pdf-viewer/webview/logic/{textLines,referenceList}.ts, pdf-viewer/webview/ui/pageText.ts
 * @dependents pdf-viewer/webview/ui/hoverPreview.ts, pdf-viewer/webview/main.ts
 */
import { entryAtY, entryByNumber, findReferencesStart, matchAuthorYear, splitReferenceEntries, type AuthorYearQuery, type ReferenceEntry } from "../logic/referenceList.js";
import type { TextLine } from "../logic/textLines.js";
import type { PageTextCache } from "./pageText.js";

export interface ResolvedEntry {
  text: string;
  pageNumber: number;
  /** Top of the entry's first line in PDF space, for jumping to it. */
  y: number;
}

interface ReferencesRegion {
  pageNumber: number;
  headingLine: TextLine;
  headingIndex: number;
}

// References sit at the back; scanning further forward mostly finds "References" inside a table of contents.
const SCAN_FRACTION = 0.4;
const MIN_SCAN_PAGES = 4;
// Books keep references per chapter; extracting hundreds of pages of text on the first hover would find nothing useful.
const MAX_SCAN_PAGES = 60;
const MAX_REFERENCE_PAGES = 25;

export class CitationResolver {
  private readonly entries = new Map<number, ReferenceEntry[]>();
  private region: Promise<ReferencesRegion | null> | null = null;

  constructor(private readonly pages: PageTextCache) {}

  /**
   * Finds the References section in the background so the first citation hover does not pay for it.
   * @usedBy pdf-viewer/webview/main.ts
   * @returns void
   */
  warmUp(): void {
    void this.getRegion().catch(() => null);
  }

  /**
   * @usedBy pdf-viewer/webview/ui/hoverPreview.ts
   * @returns true when a destination lands inside the References section.
   */
  async isInReferences(pageNumber: number, y: number | null, x: number | null): Promise<boolean> {
    const region = await this.getRegion();
    if (!region) { return false; }
    if (pageNumber !== region.pageNumber) { return pageNumber > region.pageNumber; }
    if (y === null) { return false; }
    const { columnSplit } = await this.pages.get(pageNumber);
    // In a two-column page the list may continue at the top of the right column, above the heading's y.
    const destColumn = columnSplit !== null && x !== null && x > columnSplit ? 1 : 0;
    return destColumn > region.headingLine.column || y <= region.headingLine.y + region.headingLine.height;
  }

  /**
   * @usedBy pdf-viewer/webview/ui/hoverPreview.ts
   * @returns the reference text at a destination, or null when the layout gives no reliable entry boundaries.
   */
  async entryAt(pageNumber: number, y: number, x: number | null): Promise<string | null> {
    const entries = await this.pageEntries(pageNumber);
    const { columnSplit } = await this.pages.get(pageNumber);
    return entryAtY(entries, { y, x, columnSplit })?.text ?? null;
  }

  /**
   * Numeric lookup for PDFs whose citations are plain text. Scans the pages from the heading onward.
   * @usedBy pdf-viewer/webview/ui/hoverPreview.ts
   * @returns the entry text and its page, or null.
   */
  async entryNumbered(n: number): Promise<ResolvedEntry | null> {
    const region = await this.getRegion();
    if (!region) { return null; }
    const last = this.lastReferencesPage(region);
    for (let p = region.pageNumber; p <= last; p++) {
      const hit = entryByNumber(await this.pageEntries(p), n);
      if (hit) { return { text: hit.text, pageNumber: p, y: hit.yFirst + hit.lineHeight }; }
    }
    return null;
  }

  /**
   * Lookup for author–year citations ("(SILVA; COSTA, 2020)", "Souza et al. (2019)") in PDFs whose citations are plain text.
   * @usedBy pdf-viewer/webview/ui/hoverPreview.ts
   * @returns the matching entries with their page (several when the list has several candidates), or [].
   */
  async entriesByAuthorYear(query: AuthorYearQuery): Promise<ResolvedEntry[]> {
    const region = await this.getRegion();
    if (!region) { return []; }
    const out: ResolvedEntry[] = [];
    const last = this.lastReferencesPage(region);
    for (let p = region.pageNumber; p <= last && out.length < 3; p++) {
      for (const hit of matchAuthorYear(await this.pageEntries(p), query)) {
        if (out.length < 3) { out.push({ text: hit.text, pageNumber: p, y: hit.yFirst + hit.lineHeight }); }
      }
    }
    return out;
  }

  // Appendices can follow the list; reading a couple of dozen pages past the heading covers any real bibliography.
  private lastReferencesPage(region: ReferencesRegion): number {
    return Math.min(this.pages.numPages, region.pageNumber + MAX_REFERENCE_PAGES);
  }

  private getRegion(): Promise<ReferencesRegion | null> {
    this.region ??= this.locate();
    return this.region;
  }

  private async locate(): Promise<ReferencesRegion | null> {
    const total = this.pages.numPages;
    const span = Math.min(MAX_SCAN_PAGES, Math.max(MIN_SCAN_PAGES, Math.ceil(total * SCAN_FRACTION)));
    const first = Math.max(1, total - span + 1);
    for (let p = total; p >= first; p--) {
      const { lines } = await this.pages.get(p);
      const idx = findReferencesStart(lines);
      if (idx >= 0) { return { pageNumber: p, headingLine: lines[idx]!, headingIndex: idx }; }
    }
    return null;
  }

  private async pageEntries(pageNumber: number): Promise<ReferenceEntry[]> {
    const cached = this.entries.get(pageNumber);
    if (cached) { return cached; }
    const region = await this.getRegion();
    const { lines } = await this.pages.get(pageNumber);
    const relevant = region && region.pageNumber === pageNumber ? lines.slice(region.headingIndex + 1) : lines;
    const entries = splitReferenceEntries(relevant);
    this.entries.set(pageNumber, entries);
    return entries;
  }
}
