/**
 * Overlay toolbar. It floats above the page (never part of the layout) so showing or hiding it cannot resize the viewer and trigger a re-raster.
 */
import { initialAutohide, toolbarVisibility, type AutohideEvent, type AutohideState } from "../../logic/index.js";
import { byId, h, iconButton } from "./dom.js";
import { icon } from "./icons.js";
import { isPopoverOpen, onPopoverToggle } from "./popover.js";

export interface ToolbarActions {
  toggleSidebar(): void;
  historyBack(): void;
  historyForward(): void;
  openFind(): void;
  openTheme(anchor: HTMLElement): void;
  openCheatsheet(): void;
}

export class Toolbar {
  private readonly el = byId("toolbar");
  private readonly backBtn: HTMLButtonElement;
  private readonly forwardBtn: HTMLButtonElement;
  private readonly sidebarBtn: HTMLButtonElement;
  private state: AutohideState = initialAutohide;
  private lastScrollTop = 0;
  private pointerY: number | null = null;
  private findOpen = false;
  private autoHide: boolean;
  private engaged = false;

  constructor(
    private readonly container: HTMLElement,
    title: string,
    isMac: boolean,
    autoHide: boolean,
    actions: ToolbarActions,
  ) {
    this.autoHide = autoHide;
    const mod = isMac ? "Cmd" : "Ctrl";
    const alt = isMac ? "Option" : "Alt";
    this.sidebarBtn = iconButton(icon("sidebar"), "Toggle sidebar (F4)");
    this.backBtn = iconButton(icon("arrow-left"), `Back (${alt}+Left)`);
    this.forwardBtn = iconButton(icon("arrow-right"), `Forward (${alt}+Right)`);
    const findBtn = iconButton(icon("search"), `Find (${mod}+F)`);
    const themeBtn = iconButton(icon("droplet"), "Page theme");
    const helpBtn = iconButton(icon("help"), "Keyboard shortcuts (?)");
    this.backBtn.disabled = true;
    this.forwardBtn.disabled = true;

    this.sidebarBtn.addEventListener("click", actions.toggleSidebar);
    this.backBtn.addEventListener("click", actions.historyBack);
    this.forwardBtn.addEventListener("click", actions.historyForward);
    findBtn.addEventListener("click", actions.openFind);
    themeBtn.addEventListener("click", () => actions.openTheme(themeBtn));
    helpBtn.addEventListener("click", actions.openCheatsheet);

    this.el.append(
      h("div", { class: "rd-toolbar-group" }, this.sidebarBtn, this.backBtn, this.forwardBtn),
      h("div", { class: "rd-toolbar-title", title }, title),
      h("div", { class: "rd-toolbar-group" }, findBtn, themeBtn, helpBtn),
    );

    // The bar stays put through pdf.js' own scrolling at open/restore; it starts auto-hiding once the reader moves.
    const engage = (): void => { this.engaged = true; };
    for (const type of ["wheel", "touchmove", "pointerdown"] as const) {
      container.addEventListener(type, engage, { passive: true });
    }
    document.addEventListener("keydown", engage, { passive: true });

    container.addEventListener("scroll", () => {
      const top = container.scrollTop;
      const delta = top - this.lastScrollTop;
      this.lastScrollTop = top;
      if (delta !== 0) { this.step({ kind: "scroll", delta }); }
    }, { passive: true });
    const shell = byId("pdf-shell");
    shell.addEventListener("mousemove", (e) => {
      this.pointerY = e.clientY - shell.getBoundingClientRect().top;
      this.step({ kind: "inputs" });
    }, { passive: true });
    shell.addEventListener("mouseleave", () => { this.pointerY = null; this.step({ kind: "inputs" }); });
    this.el.addEventListener("focusin", () => this.step({ kind: "inputs" }));
    this.el.addEventListener("focusout", () => this.step({ kind: "inputs" }));
    onPopoverToggle(() => this.step({ kind: "inputs" }));
  }

  /**
   * Enables or disables the back/forward buttons.
   * @returns void
   */
  setHistoryState(canGoBack: boolean, canGoForward: boolean): void {
    this.backBtn.disabled = !canGoBack;
    this.forwardBtn.disabled = !canGoForward;
  }

  /**
   * Reflects the sidebar's open state on the toggle button.
   * @returns void
   */
  setSidebarOpen(open: boolean): void {
    this.sidebarBtn.setAttribute("aria-pressed", open ? "true" : "false");
  }

  /**
   * Pins the toolbar visible while the find bar is open.
   * @returns void
   */
  setFindOpen(open: boolean): void {
    this.findOpen = open;
    this.step({ kind: "inputs" });
  }

  /**
   * Applies the `labshelf.reader.toolbarAutoHide` setting.
   * @returns void
   */
  setAutoHide(enabled: boolean): void {
    this.autoHide = enabled;
    this.step({ kind: "inputs" });
  }

  private step(event: AutohideEvent): void {
    const next = toolbarVisibility(this.state, event, {
      enabled: this.autoHide,
      engaged: this.engaged,
      scrollTop: this.container.scrollTop,
      pointerY: this.pointerY,
      focusWithin: this.el.contains(document.activeElement),
      findOpen: this.findOpen,
      menuOpen: isPopoverOpen(),
    });
    const changed = next.visible !== this.state.visible;
    this.state = next;
    if (changed) { this.render(); }
  }

  private render(): void {
    this.el.classList.toggle("rd-toolbar-hidden", !this.state.visible);
    document.documentElement.classList.toggle("rd-chrome-hidden", !this.state.visible);
  }
}
