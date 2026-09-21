/**
 * Floating page/zoom pill at the bottom-right: the only always-visible chrome. The page number is an editable go-to-page field; the zoom label opens the fit menu.
 *
 * @depends pdf-viewer/webview/logic/zoomMath.ts, pdf-viewer/webview/ui/{dom,icons,popover,zoomController,context}.ts
 * @dependents pdf-viewer/webview/main.ts
 */
import { formatZoomLabel } from "../logic/zoomMath.js";
import type { ReaderContext } from "./context.js";
import { byId, h, iconButton } from "./dom.js";
import { icon } from "./icons.js";
import { buildMenu, togglePopover, type MenuItem } from "./popover.js";
import type { ZoomController } from "./zoomController.js";

const PERCENT_CHOICES = [50, 75, 100, 125, 150, 200, 300, 400];

export class StatusPill {
  private readonly pageInput: HTMLInputElement;
  private readonly zoomBtn: HTMLButtonElement;

  constructor(
    private readonly ctx: ReaderContext,
    private readonly zoom: ZoomController,
    private readonly goToPage: (page: number) => void,
  ) {
    const total = ctx.pdfDocument.numPages;
    this.pageInput = h("input", {
      class: "rd-page-input",
      type: "text",
      inputmode: "numeric",
      "aria-label": "Go to page",
      title: "Go to page",
      size: String(total).length,
    });
    this.zoomBtn = h("button", { class: "rd-zoom-label", type: "button", title: "Zoom options", "aria-haspopup": "menu" });
    const out = iconButton(icon("minus"), "Zoom out", "rd-btn-sm");
    const inn = iconButton(icon("plus"), "Zoom in", "rd-btn-sm");
    out.addEventListener("click", () => zoom.zoomOut());
    inn.addEventListener("click", () => zoom.zoomIn());
    this.zoomBtn.addEventListener("click", () => this.openZoomMenu());

    this.pageInput.addEventListener("focus", () => this.pageInput.select());
    this.pageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { this.commitPage(); this.pageInput.blur(); ctx.container.focus({ preventScroll: true }); }
      if (e.key === "Escape") { this.sync(); this.pageInput.blur(); ctx.container.focus({ preventScroll: true }); }
    });
    this.pageInput.addEventListener("blur", () => this.sync());

    byId("status-pill").append(
      h("div", { class: "rd-pill-group" }, this.pageInput, h("span", { class: "rd-page-total" }, `/ ${total}`)),
      h("div", { class: "rd-pill-sep" }),
      h("div", { class: "rd-pill-group" }, out, this.zoomBtn, inn),
    );

    ctx.eventBus.on("pagechanging", () => this.sync());
    ctx.eventBus.on("scalechanging", () => this.sync());
    this.sync();
  }

  /**
   * Focuses the page-number field for a keyboard-driven go-to-page.
   * @usedBy pdf-viewer/webview/main.ts
   * @returns void
   */
  focusPageInput(): void {
    this.pageInput.focus();
  }

  private sync(): void {
    if (document.activeElement !== this.pageInput) {
      this.pageInput.value = String(this.ctx.pdfViewer.currentPageNumber);
    }
    this.zoomBtn.textContent = formatZoomLabel(this.zoom.scale);
  }

  private commitPage(): void {
    const n = parseInt(this.pageInput.value, 10);
    if (Number.isInteger(n) && n >= 1 && n <= this.ctx.pdfDocument.numPages) { this.goToPage(n); }
    this.sync();
  }

  private openZoomMenu(): void {
    const value = this.zoom.scaleValue;
    const items: MenuItem[] = [
      { label: "Fit width", checked: value === "page-width", run: () => this.zoom.setPreset("page-width") },
      { label: "Fit page", checked: value === "page-fit", run: () => this.zoom.setPreset("page-fit") },
      { label: "Actual size", checked: value === "page-actual", run: () => this.zoom.setPreset("page-actual") },
      { label: "Automatic", checked: value === "auto", run: () => this.zoom.setPreset("auto") },
      ...PERCENT_CHOICES.map((p, i): MenuItem => ({
        label: `${p}%`,
        separatorBefore: i === 0,
        checked: Math.round(this.zoom.scale * 100) === p && !["page-width", "page-fit", "page-actual", "auto"].includes(value),
        run: () => this.zoom.setScale(p / 100),
      })),
    ];
    togglePopover(this.zoomBtn, buildMenu(items), "above");
  }
}
