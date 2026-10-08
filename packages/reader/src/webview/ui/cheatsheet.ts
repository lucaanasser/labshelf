/**
 * `?` overlay listing every active shortcut, generated from the keymap so it can never drift from the real bindings.
 *
 * @depends webview/logic/keymap.ts, webview/ui/dom.ts, webview/ui/context.ts (types only)
 * @dependents webview/reader.ts
 */
import { cheatsheetRows } from "../logic/keymap.js";
import type { ReaderContext } from "./context.js";
import { byId, h } from "./dom.js";

export class Cheatsheet {
  private readonly el = byId("cheatsheet");

  constructor(private readonly ctx: ReaderContext) {
    this.el.addEventListener("mousedown", (e) => { if (e.target === this.el) { this.close(); } });
  }

  get isOpen(): boolean { return this.el.classList.contains("rd-open"); }

  /**
   * Opens the overlay if closed, closes it if open.
   * @usedBy webview/reader.ts
   * @returns void
   */
  toggle(): void {
    if (this.isOpen) { this.close(); } else { this.open(); }
  }

  /**
   * Closes the overlay and clears its content.
   * @usedBy webview/reader.ts
   * @returns void
   */
  close(): void {
    this.el.classList.remove("rd-open");
    this.el.replaceChildren();
  }

  private open(): void {
    const rows = cheatsheetRows({ vimKeys: this.ctx.prefs.vimKeys, isMac: this.ctx.boot.isMac });
    const card = h("div", { class: "rd-cheat-card", role: "dialog", "aria-label": "Keyboard shortcuts" });
    card.append(h("div", { class: "rd-cheat-title" }, "Keyboard shortcuts"));
    const grid = h("div", { class: "rd-cheat-grid" });
    let group = "";
    let column: HTMLElement | null = null;
    for (const row of rows) {
      if (row.group !== group || !column) {
        group = row.group;
        column = h("div", { class: "rd-cheat-col" }, h("div", { class: "rd-cheat-group" }, group));
        grid.append(column);
      }
      const keys = h("span", { class: "rd-cheat-keys" });
      row.keys.forEach((k, i) => {
        if (i > 0) { keys.append(" "); }
        keys.append(h("kbd", {}, k));
      });
      column.append(h("div", { class: "rd-cheat-row" }, h("span", {}, row.label), keys));
    }
    card.append(grid);
    if (!this.ctx.prefs.vimKeys) {
      card.append(h("div", { class: "rd-cheat-note" }, "Enable labshelf.reader.vimKeys for single-key vim navigation (j/k, gg/G, /, n/N, H/L)."));
    }
    this.el.replaceChildren(card);
    this.el.classList.add("rd-open");
  }
}
