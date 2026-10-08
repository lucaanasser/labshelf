/**
 * Zoom interactions: cursor-anchored ctrl/cmd+wheel and pinch, ladder steps, fit modes, and refit on resize.
 */
import type { ZoomPreset } from "../../index.js";
import {
  createDebouncer,
  anchorOrigin,
  boundedFactor,
  clampScale,
  isPresetScale,
  nextZoomStep,
  wheelToScaleFactor,
} from "../../logic/index.js";
import type { ReaderContext } from "./context.js";

// pdf.js CSS-scales the rendered canvases immediately and re-rasters once the gesture has been quiet this long.
const WHEEL_DRAWING_DELAY_MS = 400;
const STEP_DRAWING_DELAY_MS = 150;
const REFIT_DEBOUNCE_MS = 120;

export class ZoomController {
  private pendingFactor = 1;
  private pendingOrigin: [number, number] | null = null;
  private frame: number | null = null;

  constructor(private readonly ctx: ReaderContext) {
    const { container } = ctx;
    // Chromium reports a trackpad pinch as ctrl+wheel, so this one listener covers both.
    container.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });

    // pdf.js does not refit on resize; re-apply the preset, but never touch a numeric zoom the reader chose.
    const refit = createDebouncer(() => {
      const value = ctx.pdfViewer.currentScaleValue;
      if (isPresetScale(value)) { ctx.pdfViewer.currentScaleValue = value; }
      ctx.pdfViewer.update();
    }, REFIT_DEBOUNCE_MS);
    let lastWidth = container.clientWidth;
    new ResizeObserver(() => {
      if (container.clientWidth === lastWidth) { return; }
      lastWidth = container.clientWidth;
      refit.call();
    }).observe(container);
  }

  get scale(): number { return this.ctx.pdfViewer.currentScale; }
  get scaleValue(): string { return this.ctx.pdfViewer.currentScaleValue; }

  /**
   * @returns void
   */
  zoomIn(): void { this.setScale(nextZoomStep(this.scale, 1)); }
  /**
   * @returns void
   */
  zoomOut(): void { this.setScale(nextZoomStep(this.scale, -1)); }

  /**
   * @returns void
   */
  setPreset(preset: ZoomPreset): void {
    this.ctx.pdfViewer.currentScaleValue = preset;
  }

  /**
   * Steps keep the viewport centre fixed, which is what a reader expects from a button or a key.
   * @returns void
   */
  setScale(scale: number): void {
    const target = clampScale(scale);
    const current = this.scale;
    if (!(current > 0) || Math.abs(target - current) < 1e-6) { return; }
    const rect = this.ctx.container.getBoundingClientRect();
    this.ctx.pdfViewer.updateScale({
      scaleFactor: target / current,
      drawingDelay: STEP_DRAWING_DELAY_MS,
      origin: this.origin(rect.left + rect.width / 2, rect.top + rect.height / 2),
    });
  }

  private origin(clientX: number, clientY: number): [number, number] {
    const { container } = this.ctx;
    return anchorOrigin(
      clientX,
      clientY,
      container.getBoundingClientRect(),
      { left: container.offsetLeft, top: container.offsetTop },
    );
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) { return; }
    e.preventDefault();
    this.pendingFactor *= wheelToScaleFactor(e.deltaY, e.deltaMode);
    this.pendingOrigin = this.origin(e.clientX, e.clientY);
    if (this.frame !== null) { return; }
    // A pinch fires many events per frame; one updateScale per frame keeps the gesture smooth.
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const factor = boundedFactor(this.scale, this.pendingFactor);
      const origin = this.pendingOrigin;
      this.pendingFactor = 1;
      this.pendingOrigin = null;
      if (Math.abs(factor - 1) < 1e-4 || !origin) { return; }
      this.ctx.pdfViewer.updateScale({ scaleFactor: factor, drawingDelay: WHEEL_DRAWING_DELAY_MS, origin });
    });
  }
}
