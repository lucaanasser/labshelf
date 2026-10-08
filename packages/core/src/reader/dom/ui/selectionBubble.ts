/**
 * Floating bubble over a text selection: five highlight colours and "copy with citation".
 */
import type { AnnotationColor } from "../../../types/index.js";
import type { ReaderContext } from "./context.js";
import { byId, clamp, h, iconButton } from "./dom.js";
import { icon } from "./icons.js";

const COLORS: readonly AnnotationColor[] = ["yellow", "green", "blue", "red", "pink"];
const HIDE_GRACE_MS = 150;

export interface SelectionInfo {
  text: string;
  pageNumber: number;
}

export class SelectionBubble {
  private readonly el = byId("selection-toolbar");
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ctx: ReaderContext) {
    const mod = ctx.boot.isMac ? "Cmd" : "Ctrl";
    for (const color of COLORS) {
      const btn = h("button", { class: `rd-color-btn rd-color-${color}`, type: "button", title: `Highlight ${color}`, "aria-label": `Highlight ${color}` });
      btn.addEventListener("click", () => this.highlight(color));
      this.el.append(btn);
    }
    const cite = iconButton(icon("quote"), `Copy with citation (${mod}+Shift+C)`, "rd-btn-sm");
    cite.addEventListener("click", () => this.copyWithCitation());
    this.el.append(h("div", { class: "rd-pill-sep" }), cite);

    // Keep the selection alive while the bubble is being clicked.
    this.el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (this.hideTimer) { clearTimeout(this.hideTimer); }
    });
    document.addEventListener("mouseup", (e) => {
      if (this.el.contains(e.target as Node)) { return; }
      // The selection is final only after the browser has processed the mouseup.
      setTimeout(() => this.showForSelection(), 0);
    });
    document.addEventListener("mousedown", (e) => {
      if (this.el.contains(e.target as Node)) { return; }
      this.hideTimer = setTimeout(() => this.hide(), HIDE_GRACE_MS);
    });
    ctx.container.addEventListener("scroll", () => this.hide(), { passive: true });
  }

  /**
   * The highlight belongs to the page that contains the selected text, which is not necessarily the viewer's "current" page when two pages share the screen.
   * @returns the selected text and the page it belongs to, or null when nothing usable is selected.
   */
  currentSelection(): SelectionInfo | null {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!sel || !text || sel.rangeCount === 0) { return null; }
    const start = sel.getRangeAt(0).startContainer;
    const startEl = start instanceof Element ? start : start.parentElement;
    const pageEl = startEl?.closest<HTMLElement>("#viewer .page");
    if (!pageEl) { return null; }
    const pageNumber = Number(pageEl.dataset["pageNumber"]) || this.ctx.pdfViewer.currentPageNumber;
    return { text, pageNumber };
  }

  /**
   * Sends the current selection to the host to be copied with a citation.
   * @returns void
   */
  copyWithCitation(): void {
    const info = this.currentSelection();
    if (!info) { return; }
    this.ctx.host.post({ command: "copyWithCitation", text: info.text, pageNumber: info.pageNumber });
    this.hide();
  }

  /**
   * Hides the bubble.
   * @returns void
   */
  hide(): void {
    this.el.classList.remove("rd-visible");
  }

  private highlight(color: AnnotationColor): void {
    const info = this.currentSelection();
    if (!info) { return; }
    this.ctx.host.post({ command: "createAnnotation", type: "highlight", pageNumber: info.pageNumber, content: info.text, color });
    window.getSelection()?.removeAllRanges();
    this.hide();
  }

  private showForSelection(): void {
    const info = this.currentSelection();
    const sel = window.getSelection();
    if (!info || !sel || sel.rangeCount === 0) { this.hide(); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    this.el.classList.add("rd-visible");
    const own = this.el.getBoundingClientRect();
    const above = rect.top - own.height - 8;
    const top = above >= 8 ? above : rect.bottom + 8;
    this.el.style.top = `${clamp(top, 8, window.innerHeight - own.height - 8)}px`;
    this.el.style.left = `${clamp(rect.left + rect.width / 2 - own.width / 2, 8, window.innerWidth - own.width - 8)}px`;
  }
}
