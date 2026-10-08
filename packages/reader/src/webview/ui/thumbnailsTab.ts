/**
 * Thumbnails tab. pdf.js' own thumbnail viewer is not exported from pdf_viewer.mjs, so this is a small lazy renderer: placeholders for every page, canvases only for the ones on screen.
 *
 * @depends webview/ui/{dom,sidebar,theme,context}.ts, pdfjs-dist (types only)
 * @dependents webview/reader.ts
 */
import type { RenderTask } from "pdfjs-dist";
import type { ReaderContext } from "./context.js";
import { h } from "./dom.js";
import type { SidebarPanel } from "./sidebar.js";
import type { ThemeController } from "./theme.js";

const THUMB_CSS_WIDTH = 132;
const MAX_CONCURRENT = 2;
// retainContextWhenHidden keeps this webview alive; release canvases once the tab has been out of sight for a while.
const TEARDOWN_AFTER_HIDDEN_MS = 60_000;

interface Thumb {
  pageNumber: number;
  el: HTMLElement;
  frame: HTMLElement;
  state: "idle" | "queued" | "rendering" | "done";
  task: RenderTask | null;
}

export class ThumbnailsTab implements SidebarPanel {
  readonly el = h("div", { class: "rd-panel rd-thumbs", role: "tabpanel" });
  private readonly list = h("div", { class: "rd-thumb-list" });
  private readonly thumbs: Thumb[] = [];
  private readonly queue: Thumb[] = [];
  private running = 0;
  private built = false;
  private visible = false;
  private observer: IntersectionObserver | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: ReaderContext,
    private readonly theme: ThemeController,
    private readonly goToPage: (page: number) => void,
  ) {
    this.el.append(this.list);
    ctx.eventBus.on("pagechanging", () => { if (this.visible) { this.markCurrent(true); } });
    theme.onPageColorsChange(() => this.reset());
  }

  /**
   * Builds the thumbnail list on first show; cancels the pending teardown otherwise.
   * @usedBy webview/ui/sidebar.ts (Sidebar)
   * @returns void
   */
  onShow(): void {
    this.visible = true;
    if (this.teardownTimer) { clearTimeout(this.teardownTimer); this.teardownTimer = null; }
    if (!this.built) { void this.build(); } else { this.markCurrent(false); }
  }

  /**
   * Cancels in-flight renders and schedules canvas teardown after the tab has been hidden a while.
   * @usedBy webview/ui/sidebar.ts (Sidebar)
   * @returns void
   */
  onHide(): void {
    this.visible = false;
    this.cancelAll();
    this.teardownTimer = setTimeout(() => this.reset(), TEARDOWN_AFTER_HIDDEN_MS);
  }

  private async build(): Promise<void> {
    this.built = true;
    const doc = this.ctx.pdfDocument;
    // Page 1's aspect ratio sizes every placeholder; the real ratio is applied when a page renders.
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const ratio = vp.height / vp.width;
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.el,
      rootMargin: "300px 0px",
    });
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= doc.numPages; n++) {
      const frame = h("div", { class: "rd-thumb-frame", style: `width:${THUMB_CSS_WIDTH}px;height:${Math.round(THUMB_CSS_WIDTH * ratio)}px` });
      const el = h("div", { class: "rd-thumb", role: "button", tabindex: 0, "data-page": n, title: `Page ${n}` }, frame, h("span", { class: "rd-thumb-label" }, String(n)));
      el.addEventListener("click", () => this.goToPage(n));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") { this.goToPage(n); } });
      this.thumbs.push({ pageNumber: n, el, frame, state: "idle", task: null });
      this.observer.observe(el);
      frag.append(el);
    }
    this.list.append(frag);
    this.markCurrent(false);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const thumb = this.thumbs[Number((entry.target as HTMLElement).dataset["page"]) - 1];
      if (!thumb) { continue; }
      if (entry.isIntersecting && thumb.state === "idle") {
        thumb.state = "queued";
        this.queue.push(thumb);
      } else if (!entry.isIntersecting && thumb.state === "queued") {
        thumb.state = "idle";
        this.queue.splice(this.queue.indexOf(thumb), 1);
      } else if (!entry.isIntersecting && thumb.state === "rendering") {
        thumb.task?.cancel();
      }
    }
    this.pump();
  }

  private pump(): void {
    while (this.visible && this.running < MAX_CONCURRENT && this.queue.length > 0) {
      const thumb = this.queue.shift()!;
      this.running++;
      void this.renderThumb(thumb).finally(() => { this.running--; this.pump(); });
    }
  }

  private async renderThumb(thumb: Thumb): Promise<void> {
    thumb.state = "rendering";
    try {
      const page = await this.ctx.pdfDocument.getPage(thumb.pageNumber);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (THUMB_CSS_WIDTH / base.width) * dpr });
      const canvas = h("canvas", { class: "rd-thumb-canvas" });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      thumb.frame.style.height = `${Math.round(THUMB_CSS_WIDTH * (base.height / base.width))}px`;
      const canvasContext = canvas.getContext("2d", { alpha: false });
      if (!canvasContext) { throw new Error("2d context unavailable"); }
      const pageColors = this.theme.pageColors;
      thumb.task = page.render({
        canvas,
        canvasContext,
        viewport,
        ...(pageColors ? { pageColors } : {}),
      } as Parameters<typeof page.render>[0]);
      await thumb.task.promise;
      thumb.frame.replaceChildren(canvas);
      thumb.state = "done";
    } catch {
      // Cancelled (scrolled away, tab hidden, theme changed) or failed: eligible again next time it is on screen.
      thumb.state = "idle";
    } finally {
      thumb.task = null;
    }
  }

  private markCurrent(smooth: boolean): void {
    const current = this.ctx.pdfViewer.currentPageNumber;
    for (const t of this.thumbs) { t.el.classList.toggle("rd-active", t.pageNumber === current); }
    this.thumbs[current - 1]?.el.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  }

  private cancelAll(): void {
    for (const t of this.queue) { t.state = "idle"; }
    this.queue.length = 0;
    for (const t of this.thumbs) { t.task?.cancel(); }
  }

  /** Drops every canvas; they re-render lazily with the current page colours. */
  private reset(): void {
    this.cancelAll();
    for (const t of this.thumbs) {
      if (t.state === "done") { t.frame.replaceChildren(); t.state = "idle"; }
    }
    if (this.visible && this.observer) {
      // Re-observing re-fires intersection callbacks for the thumbs currently on screen.
      for (const t of this.thumbs) { this.observer.unobserve(t.el); this.observer.observe(t.el); }
    }
  }
}
