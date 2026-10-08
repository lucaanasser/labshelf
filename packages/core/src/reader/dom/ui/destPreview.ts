/**
 * Renders part of a page into a small canvas for the hover popup: the band around a link's destination, or an explicit
 * region such as a figure located from its caption.
 */
import type { PageViewport, RenderTask } from "pdfjs-dist";
import { type PdfRegion, cropRectForPreview, type Rect } from "../../logic/index.js";
import type { ReaderContext } from "./context.js";
import type { ThemeController } from "./theme.js";

// Wide enough that a figure or a small table is readable without jumping to it; narrower panels shrink it to fit.
export const PREVIEW_CSS_WIDTH = 560;
const PREVIEW_MARGIN = 32;
// Pages are rendered denser than the popup needs so that a single column of a two-column page (half the width) can
// still be shown at a useful size without going soft.
const OVERSAMPLE = 1.25;
// Hovering back and forth between a few links should not re-render; more than this is memory for nothing.
const PAGE_CACHE = 4;

function popupWidth(): number {
  return Math.max(240, Math.min(PREVIEW_CSS_WIDTH, window.innerWidth - PREVIEW_MARGIN));
}

interface RenderedPage {
  canvas: HTMLCanvasElement;
  viewport: PageViewport;
  dpr: number;
}

export class DestPreview {
  private readonly cache = new Map<number, RenderedPage>();
  private task: RenderTask | null = null;

  constructor(private readonly ctx: ReaderContext, private readonly theme: ThemeController) {
    theme.onPageColorsChange(() => this.cache.clear());
  }

  /**
   * Cancels any in-flight page render.
   * @returns void
   */
  cancel(): void {
    this.task?.cancel();
    this.task = null;
  }

  /**
   * @param pdfY destination y in PDF space, or null for "top of page".
   * @returns a canvas sized for the popup, or null when rendering was cancelled.
   */
  async render(pageNumber: number, pdfX: number | null, pdfY: number | null): Promise<HTMLCanvasElement | null> {
    const full = await this.fullPage(pageNumber);
    if (!full) { return null; }
    // convertToViewportPoint handles the page's rotation and the bottom-left PDF origin.
    const anchorY = pdfY === null ? null : (full.viewport.convertToViewportPoint(pdfX ?? 0, pdfY)[1] ?? null);
    return this.crop(full, cropRectForPreview(anchorY, full.canvas.width, full.canvas.height), popupWidth());
  }

  /**
   * @param region rectangle in PDF user space, e.g. a figure plus its caption.
   * @returns a canvas sized for the popup, or null when rendering was cancelled.
   */
  async renderRegion(pageNumber: number, region: PdfRegion): Promise<HTMLCanvasElement | null> {
    const full = await this.fullPage(pageNumber);
    if (!full) { return null; }
    const [ax, ay] = full.viewport.convertToViewportPoint(region.x0, region.yTop);
    const [bx, by] = full.viewport.convertToViewportPoint(region.x1, region.yBottom);
    const x = Math.max(0, Math.min(ax ?? 0, bx ?? 0));
    const y = Math.max(0, Math.min(ay ?? 0, by ?? 0));
    const rect: Rect = {
      x,
      y,
      width: Math.max(1, Math.min(full.canvas.width - x, Math.abs((bx ?? 0) - (ax ?? 0)))),
      height: Math.max(1, Math.min(full.canvas.height - y, Math.abs((by ?? 0) - (ay ?? 0)))),
    };
    return this.crop(full, rect, Math.min(popupWidth(), Math.round(rect.width / full.dpr)));
  }

  private crop(full: RenderedPage, rect: Rect, cssWidth: number): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = Math.round(rect.width);
    out.height = Math.round(rect.height);
    out.style.width = `${cssWidth}px`;
    out.style.height = `${Math.round((rect.height / rect.width) * cssWidth)}px`;
    out.getContext("2d")?.drawImage(full.canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
    return out;
  }

  private async fullPage(pageNumber: number): Promise<RenderedPage | null> {
    const cached = this.cache.get(pageNumber);
    if (cached) {
      // Refresh recency.
      this.cache.delete(pageNumber);
      this.cache.set(pageNumber, cached);
      return cached;
    }
    this.cancel();
    const page = await this.ctx.pdfDocument.getPage(pageNumber);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (PREVIEW_CSS_WIDTH * dpr * OVERSAMPLE) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const canvasContext = canvas.getContext("2d", { alpha: false });
    if (!canvasContext) { return null; }
    const pageColors = this.theme.pageColors;
    const task = page.render({
      canvas,
      canvasContext,
      viewport,
      ...(pageColors ? { pageColors } : {}),
    } as Parameters<typeof page.render>[0]);
    this.task = task;
    try {
      await task.promise;
    } catch {
      return null;
    } finally {
      if (this.task === task) { this.task = null; }
    }
    const rendered: RenderedPage = { canvas, viewport, dpr };
    this.cache.set(pageNumber, rendered);
    if (this.cache.size > PAGE_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) { this.cache.delete(oldest); }
    }
    return rendered;
  }
}
