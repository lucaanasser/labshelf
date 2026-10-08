/**
 * The reader's single left sidebar: a tab strip (Thumbnails / Outline / Annotations), a drag-resizable width, and open/tab/width state reported for persistence.
 *
 * @depends pdf-viewer/shared/readingState.ts, pdf-viewer/webview/ui/{dom,icons}.ts
 * @dependents pdf-viewer/webview/main.ts, pdf-viewer/webview/ui/readingStateReporter.ts (types only), pdf-viewer/webview/ui/{outlineTab,thumbnailsTab,annotationsTab}.ts (types only)
 */
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, type SidebarState, type SidebarTab } from "../../shared/readingState.js";
import { byId, clamp, h } from "./dom.js";
import { icon, type IconName } from "./icons.js";

export interface SidebarPanel {
  readonly el: HTMLElement;
  onShow(): void;
  onHide(): void;
}

const DEFAULT_WIDTH = 220;
const TAB_META: Record<SidebarTab, { label: string; icon: IconName }> = {
  thumbnails: { label: "Thumbnails", icon: "grid" },
  outline: { label: "Outline", icon: "list" },
  annotations: { label: "Annotations", icon: "edit" },
};

export class Sidebar {
  private readonly el = byId("sidebar");
  private readonly resizer = byId("sidebar-resizer");
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<SidebarTab, HTMLButtonElement>();
  private open = false;
  private tab: SidebarTab = "outline";
  private width = DEFAULT_WIDTH;
  private readonly listeners: Array<(state: SidebarState) => void> = [];

  constructor(private readonly panels: Record<SidebarTab, SidebarPanel>) {
    const strip = h("div", { class: "rd-tabs", role: "tablist", "aria-label": "Sidebar" });
    for (const name of Object.keys(TAB_META) as SidebarTab[]) {
      const meta = TAB_META[name];
      const btn = h("button", {
        class: "rd-tab", type: "button", role: "tab", title: meta.label, "aria-label": meta.label, html: icon(meta.icon),
      });
      btn.addEventListener("click", () => this.select(name));
      this.tabButtons.set(name, btn);
      strip.append(btn);
    }
    this.body = h("div", { class: "rd-sidebar-body" });
    for (const name of Object.keys(panels) as SidebarTab[]) {
      panels[name].el.hidden = true;
      this.body.append(panels[name].el);
    }
    this.el.append(strip, this.body);
    this.initResize();
    this.render();
  }

  /**
   * Registers a callback invoked whenever the open/tab/width state changes.
   * @usedBy pdf-viewer/webview/main.ts, pdf-viewer/webview/ui/readingStateReporter.ts
   * @returns void
   */
  onChange(fn: (state: SidebarState) => void): void { this.listeners.push(fn); }
  get state(): SidebarState { return { open: this.open, tab: this.tab, width: this.width }; }
  get isOpen(): boolean { return this.open; }

  /**
   * Applies persisted state without echoing it back as a change.
   * @usedBy pdf-viewer/webview/main.ts
   * @returns void
   */
  restore(state: SidebarState): void {
    this.tab = state.tab;
    this.width = clamp(state.width ?? DEFAULT_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    this.setOpen(state.open, false);
  }

  /**
   * Opens the sidebar if closed, closes it if open.
   * @usedBy pdf-viewer/webview/main.ts
   * @returns void
   */
  toggle(): void { this.setOpen(!this.open, true); }

  /**
   * Switches to the given tab, opening the sidebar first if needed.
   * @usedBy Sidebar (internal: tab-button click handler)
   * @returns void
   */
  select(tab: SidebarTab): void {
    if (this.open && this.tab === tab) { return; }
    const previous = this.tab;
    this.tab = tab;
    if (this.open && previous !== tab) { this.panels[previous].onHide(); }
    if (!this.open) { this.setOpen(true, true); return; }
    this.render();
    this.panels[tab].onShow();
    this.emit();
  }

  private setOpen(open: boolean, notify: boolean): void {
    const changed = open !== this.open;
    this.open = open;
    this.render();
    if (changed) {
      if (open) { this.panels[this.tab].onShow(); } else { this.panels[this.tab].onHide(); }
    }
    if (notify) { this.emit(); }
  }

  private render(): void {
    this.el.hidden = !this.open;
    this.resizer.hidden = !this.open;
    this.el.style.width = `${this.width}px`;
    for (const [name, btn] of this.tabButtons) {
      btn.setAttribute("aria-selected", name === this.tab ? "true" : "false");
    }
    for (const name of Object.keys(this.panels) as SidebarTab[]) {
      this.panels[name].el.hidden = name !== this.tab;
    }
  }

  private emit(): void {
    for (const fn of this.listeners) { fn(this.state); }
  }

  private initResize(): void {
    this.resizer.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      this.resizer.setPointerCapture(down.pointerId);
      const startX = down.clientX;
      const startWidth = this.width;
      document.documentElement.classList.add("rd-resizing");
      const move = (e: PointerEvent): void => {
        this.width = clamp(startWidth + e.clientX - startX, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
        this.el.style.width = `${this.width}px`;
      };
      const up = (): void => {
        this.resizer.removeEventListener("pointermove", move);
        this.resizer.removeEventListener("pointerup", up);
        this.resizer.removeEventListener("pointercancel", up);
        document.documentElement.classList.remove("rd-resizing");
        this.emit();
      };
      this.resizer.addEventListener("pointermove", move);
      this.resizer.addEventListener("pointerup", up);
      this.resizer.addEventListener("pointercancel", up);
    });
  }
}
