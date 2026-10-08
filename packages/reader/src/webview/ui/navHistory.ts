/**
 * Back/forward navigation. Installed into PDFLinkService through its duck-typed `setHistory()`, so every internal link, outline click and named destination records the place the reader left.
 *
 * @depends webview/logic/historyStack.ts, webview/ui/context.ts (types only)
 * @dependents webview/reader.ts, webview/ui/findBar.ts (types only)
 */
import { HistoryStack, type ViewLocation } from "../logic/historyStack.js";
import type { PdfLocation, ReaderContext } from "./context.js";

export class NavHistory {
  private readonly stack = new HistoryStack();
  private location: PdfLocation | null = null;
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on("updateviewarea", (evt: { location?: PdfLocation }) => {
      if (evt.location) { this.location = evt.location; }
    });
    // PDFLinkService calls pushCurrentPosition() immediately before it scrolls; push()/pushPage() carry the
    // target, which a departure-point stack does not need.
    ctx.linkService.setHistory({
      pushCurrentPosition: () => this.recordDeparture(),
      push: () => { /* target is implicit */ },
      pushPage: () => { /* target is implicit */ },
      back: () => this.back(),
      forward: () => this.forward(),
    } as unknown as Parameters<ReaderContext["linkService"]["setHistory"]>[0]);
  }

  /**
   * Registers a callback invoked whenever the back/forward availability changes.
   * @usedBy webview/reader.ts
   * @returns void
   */
  onChange(fn: () => void): void { this.listeners.push(fn); }
  get canGoBack(): boolean { return this.stack.canGoBack; }
  get canGoForward(): boolean { return this.stack.canGoForward; }

  /**
   * Call before any programmatic jump that does not go through the link service (go-to-page, thumbnails, annotations, far find hits).
   * @usedBy webview/reader.ts
   * @returns void
   */
  recordDeparture(): void {
    this.visit(this.current());
  }

  /**
   * Records an explicit departure point, for jumps only recognised after they happened.
   * @usedBy webview/ui/findBar.ts
   * @returns void
   */
  visit(from: ViewLocation): void {
    this.stack.visit(from);
    this.emit();
  }

  /**
   * Jumps to the previous departure point, if any.
   * @usedBy webview/reader.ts
   * @returns void
   */
  back(): void {
    const target = this.stack.back(this.current());
    if (target) { this.go(target); }
  }

  /**
   * Jumps to the next forward target, if any.
   * @usedBy webview/reader.ts
   * @returns void
   */
  forward(): void {
    const target = this.stack.forward(this.current());
    if (target) { this.go(target); }
  }

  /**
   * pdf.js refreshes its location one animation frame after a scroll. Two jumps inside that frame (chained commands,
   * key repeat) would record the first jump's departure point twice and lose the second; update() recomputes it now.
   * @usedBy webview/ui/findBar.ts, NavHistory (internal: recordDeparture, back, forward)
   * @returns the reader's current view location.
   */
  current(): ViewLocation {
    this.ctx.pdfViewer.update();
    const loc = this.location;
    if (!loc) { return { pageNumber: this.ctx.pdfViewer.currentPageNumber }; }
    return { pageNumber: loc.pageNumber, left: loc.left, top: loc.top };
  }

  private go(target: ViewLocation): void {
    const destArray = target.top !== undefined
      ? [null, { name: "XYZ" }, target.left ?? null, target.top, null]
      : undefined;
    this.ctx.pdfViewer.scrollPageIntoView({
      pageNumber: target.pageNumber,
      ...(destArray ? { destArray, allowNegativeOffset: true } : {}),
    });
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) { fn(); }
  }
}
