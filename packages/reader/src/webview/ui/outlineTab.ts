/**
 * Outline tab: the PDF's table of contents as a collapsible tree whose active entry follows the current page.
 *
 * @depends webview/logic/outlineModel.ts, webview/ui/{dom,icons,sidebar,context}.ts
 * @dependents webview/reader.ts
 */
import { activeOutlineIndex, flattenOutline, visibleRows, type OutlineRow, type RawOutlineNode } from "../logic/outlineModel.js";
import type { ReaderContext } from "./context.js";
import { h } from "./dom.js";
import { icon } from "./icons.js";
import type { SidebarPanel } from "./sidebar.js";

export class OutlineTab implements SidebarPanel {
  readonly el = h("div", { class: "rd-panel rd-outline", role: "tabpanel" });
  private readonly list = h("div", { class: "rd-outline-list", role: "tree" });
  private rows: OutlineRow[] = [];
  private rowPages: Array<number | null> = [];
  private readonly collapsed = new Set<number>();
  private loaded = false;
  private visible = false;

  constructor(private readonly ctx: ReaderContext) {
    this.el.append(h("div", { class: "rd-panel-header" }, h("span", {}, "Outline")), this.list);
    ctx.eventBus.on("pagechanging", () => { if (this.visible) { this.highlightActive(); } });
  }

  /**
   * Loads the outline on first show and re-highlights the active entry on later shows.
   * @usedBy webview/ui/sidebar.ts (Sidebar)
   * @returns void
   */
  onShow(): void {
    this.visible = true;
    if (!this.loaded) { void this.load(); } else { this.highlightActive(); }
  }

  /**
   * @usedBy webview/ui/sidebar.ts (Sidebar)
   * @returns void
   */
  onHide(): void { this.visible = false; }

  private async load(): Promise<void> {
    this.loaded = true;
    let raw: RawOutlineNode[] | null = null;
    try {
      raw = (await this.ctx.pdfDocument.getOutline()) as RawOutlineNode[] | null;
    } catch {
      raw = null;
    }
    this.rows = flattenOutline(raw);
    // Deep outlines open collapsed past the second level so the structure is scannable.
    for (const row of this.rows) {
      if (row.hasChildren && row.depth >= 1 && this.rows.length > 40) { this.collapsed.add(row.id); }
    }
    this.rowPages = this.rows.map(() => null);
    this.render();
    void this.resolvePages();
  }

  /** Destinations resolve to page numbers lazily; active-entry tracking sharpens as they arrive. */
  private async resolvePages(): Promise<void> {
    const doc = this.ctx.pdfDocument;
    for (const row of this.rows) {
      try {
        const explicit = typeof row.dest === "string" ? await doc.getDestination(row.dest) : row.dest;
        const ref = Array.isArray(explicit) ? (explicit[0] as unknown) : null;
        if (ref && typeof ref === "object") {
          this.rowPages[row.id] = (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1;
        } else if (typeof ref === "number" && Number.isInteger(ref)) {
          this.rowPages[row.id] = ref + 1;
        }
      } catch {
        // An unresolvable entry simply never becomes active.
      }
    }
    this.render();
  }

  private render(): void {
    if (this.rows.length === 0) {
      this.list.replaceChildren(h("div", { class: "rd-empty" }, "This PDF has no outline."));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const row of visibleRows(this.rows, this.collapsed)) {
      const isCollapsed = this.collapsed.has(row.id);
      const twisty = h("span", {
        class: `rd-twisty${row.hasChildren ? "" : " rd-twisty-leaf"}`,
        html: row.hasChildren ? icon(isCollapsed ? "chevron-right" : "chevron-down") : "",
      });
      if (row.hasChildren) {
        twisty.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isCollapsed) { this.collapsed.delete(row.id); } else { this.collapsed.add(row.id); }
          this.render();
        });
      }
      const page = this.rowPages[row.id];
      const item = h(
        "div",
        {
          class: `rd-outline-item${row.bold ? " rd-outline-bold" : ""}`,
          role: "treeitem",
          tabindex: 0,
          "data-row": row.id,
          style: `padding-left:${8 + row.depth * 14}px`,
          title: row.title,
          ...(row.hasChildren ? { "aria-expanded": isCollapsed ? "false" : "true" } : {}),
        },
        twisty,
        h("span", { class: "rd-outline-title" }, row.title),
        page ? h("span", { class: "rd-outline-page" }, String(page)) : null,
      );
      const go = (): void => this.activate(row);
      item.addEventListener("click", go);
      item.addEventListener("keydown", (e) => { if (e.key === "Enter") { go(); } });
      frag.append(item);
    }
    this.list.replaceChildren(frag);
    this.highlightActive();
  }

  private activate(row: OutlineRow): void {
    if (row.dest) {
      // Goes through the link service so the jump is recorded in the back/forward history.
      void this.ctx.linkService.goToDestination(row.dest as Parameters<ReaderContext["linkService"]["goToDestination"]>[0]);
    } else if (row.url) {
      this.ctx.host.post({ command: "openExternalLink", url: row.url });
    }
  }

  private highlightActive(): void {
    let active = activeOutlineIndex(this.rowPages, this.ctx.pdfViewer.currentPageNumber);
    // Under a collapsed parent the nearest visible ancestor stands in for the active entry.
    while (active >= 0 && !this.list.querySelector(`[data-row="${active}"]`)) {
      active = this.rows[active]?.parentId ?? -1;
    }
    for (const el of this.list.querySelectorAll<HTMLElement>(".rd-outline-item")) {
      el.classList.toggle("rd-active", Number(el.dataset["row"]) === active);
    }
    this.list.querySelector<HTMLElement>(".rd-active")?.scrollIntoView({ block: "nearest" });
  }
}
