/**
 * Find bar driving pdf.js' PDFFindController through the EventBus. "Highlight all" is always on: seeing every hit at once is the point of searching a paper.
 */
import type { ReaderContext } from "./context.js";
import { byId, h, iconButton } from "./dom.js";
import { icon } from "./icons.js";
import type { NavHistory } from "./navHistory.js";

const FAR_JUMP_SETTLE_MS = 300;

interface MatchesCount { current: number; total: number }
interface FindControlState { state: number; previous: boolean; matchesCount: MatchesCount; rawQuery: string | null }

export class FindBar {
  private readonly el = byId("find-bar");
  private readonly input: HTMLInputElement;
  private readonly count: HTMLSpanElement;
  private readonly caseBtn: HTMLButtonElement;
  private readonly wordBtn: HTMLButtonElement;
  private open = false;
  private readonly toggleListeners: Array<(open: boolean) => void> = [];

  constructor(private readonly ctx: ReaderContext, private readonly history: NavHistory) {
    this.input = h("input", { class: "rd-find-input", type: "text", placeholder: "Find in document", "aria-label": "Find in document", spellcheck: "false" });
    this.count = h("span", { class: "rd-find-count", "aria-live": "polite" });
    this.caseBtn = h("button", { class: "rd-toggle", type: "button", title: "Match case", "aria-pressed": "false" }, "Aa");
    this.wordBtn = h("button", { class: "rd-toggle", type: "button", title: "Whole words", "aria-pressed": "false" }, "W");
    const prev = iconButton(icon("chevron-up"), "Previous match (Shift+Enter)", "rd-btn-sm");
    const next = iconButton(icon("chevron-down"), "Next match (Enter)", "rd-btn-sm");
    const close = iconButton(icon("x"), "Close (Esc)", "rd-btn-sm");
    this.el.append(this.input, this.count, this.caseBtn, this.wordBtn, prev, next, close);

    this.input.addEventListener("input", () => this.dispatch(""));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.again(e.shiftKey); }
    });
    prev.addEventListener("click", () => this.again(true));
    next.addEventListener("click", () => this.again(false));
    close.addEventListener("click", () => this.close());
    for (const btn of [this.caseBtn, this.wordBtn]) {
      btn.addEventListener("click", () => {
        btn.setAttribute("aria-pressed", btn.getAttribute("aria-pressed") === "true" ? "false" : "true");
        this.dispatch("");
      });
    }

    ctx.eventBus.on("updatefindmatchescount", (evt: { matchesCount: MatchesCount }) => this.renderCount(evt.matchesCount));
    ctx.eventBus.on("updatefindcontrolstate", (evt: FindControlState) => this.renderState(evt));
  }

  get isOpen(): boolean { return this.open; }

  /**
   * Registers a callback invoked whenever the find bar opens or closes.
   * @returns void
   */
  onToggle(fn: (open: boolean) => void): void { this.toggleListeners.push(fn); }

  /**
   * Opens the find bar, pre-filling it with the current text selection.
   * @returns void
   */
  show(): void {
    if (!this.open) {
      this.open = true;
      this.el.classList.add("rd-find-open");
      for (const fn of this.toggleListeners) { fn(true); }
    }
    // Pre-fill with the current selection, as browsers and editors do.
    const selected = window.getSelection()?.toString().trim() ?? "";
    if (selected && selected.length <= 200 && !selected.includes("\n")) { this.input.value = selected; }
    this.input.focus();
    this.input.select();
    if (this.input.value) { this.dispatch(""); }
  }

  /**
   * Closes the find bar and clears the match count.
   * @returns void
   */
  close(): void {
    if (!this.open) { return; }
    this.open = false;
    this.el.classList.remove("rd-find-open");
    this.ctx.eventBus.dispatch("findbarclose", { source: this });
    this.count.textContent = "";
    this.input.classList.remove("rd-find-notfound");
    for (const fn of this.toggleListeners) { fn(false); }
    this.ctx.container.focus({ preventScroll: true });
  }

  /**
   * Next/previous hit; opens the bar instead when there is nothing to repeat.
   * @returns void
   */
  again(previous: boolean): void {
    if (!this.input.value) { this.show(); return; }
    this.dispatch("again", previous);
  }

  private dispatch(type: "" | "again", findPrevious = false): void {
    const before = this.history.current();
    this.ctx.markFindOrigin();
    this.ctx.eventBus.dispatch("find", {
      source: this,
      type,
      query: this.input.value,
      caseSensitive: this.caseBtn.getAttribute("aria-pressed") === "true",
      entireWord: this.wordBtn.getAttribute("aria-pressed") === "true",
      highlightAll: true,
      findPrevious,
      matchDiacritics: false,
    });
    if (type === "again") {
      // A hit far from here is a jump: record where the reader was so Back returns there.
      // The controller scrolls asynchronously (it may still be extracting page text); compare once it has settled.
      setTimeout(() => {
        if (Math.abs(this.ctx.pdfViewer.currentPageNumber - before.pageNumber) > 2) { this.history.visit(before); }
      }, FAR_JUMP_SETTLE_MS);
    }
  }

  private renderCount({ current, total }: MatchesCount): void {
    this.count.textContent = total > 0 ? `${current} of ${total}` : "";
  }

  private renderState(evt: FindControlState): void {
    const { FindState } = this.ctx.viewerLib;
    const notFound = evt.state === FindState.NOT_FOUND;
    this.input.classList.toggle("rd-find-notfound", notFound && this.input.value.length > 0);
    this.el.classList.toggle("rd-find-pending", evt.state === FindState.PENDING);
    if (notFound) { this.count.textContent = this.input.value ? "No results" : ""; }
    else { this.renderCount(evt.matchesCount); }
  }
}
