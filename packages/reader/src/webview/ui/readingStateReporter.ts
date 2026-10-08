/**
 * Reports the reading position (page, zoom, offset, sidebar) to the host for persistence, debounced while reading and flushed when the panel hides.
 *
 * @depends webview/logic/{debounce,zoomMath}.ts, shared/readingState.ts, webview/ui/{context,sidebar}.ts (types only)
 * @dependents webview/reader.ts
 */
import type { ReadingState } from "../../shared/readingState.js";
import { createDebouncer } from "../logic/debounce.js";
import { isPresetScale } from "../logic/zoomMath.js";
import type { PdfLocation, ReaderContext } from "./context.js";
import type { Sidebar } from "./sidebar.js";

const SAVE_DEBOUNCE_MS = 800;

export class ReadingStateReporter {
  private location: PdfLocation | null = null;
  private enabled = false;
  private readonly save = createDebouncer(() => this.post(), SAVE_DEBOUNCE_MS);

  constructor(private readonly ctx: ReaderContext, private readonly sidebar: Sidebar) {
    ctx.eventBus.on("updateviewarea", (evt: { location?: PdfLocation }) => {
      if (!evt.location) { return; }
      this.location = evt.location;
      if (this.enabled) { this.save.call(); }
    });
    sidebar.onChange(() => { if (this.enabled) { this.save.call(); } });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { this.save.flush(); } });
    window.addEventListener("pagehide", () => this.save.flush());
  }

  /**
   * Reporting starts only after restore, so the initial page-1 layout never overwrites the stored position.
   * @usedBy webview/reader.ts
   * @returns void
   */
  start(): void {
    this.enabled = true;
  }

  private post(): void {
    const loc = this.location;
    if (!loc) { return; }
    const value = this.ctx.pdfViewer.currentScaleValue;
    const state: ReadingState = {
      page: loc.pageNumber,
      // A preset survives window resizes; a number pins the exact zoom the reader chose.
      scaleValue: isPresetScale(value) ? value : String(this.ctx.pdfViewer.currentScale),
      left: loc.left,
      top: loc.top,
      sidebar: this.sidebar.state,
      updatedAt: new Date().toISOString(),
    };
    this.ctx.host.post({ command: "saveReadingState", state });
  }
}
