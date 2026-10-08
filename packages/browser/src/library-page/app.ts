/**
 * Root component of the library page. Builds the VS Code-like frame once —
 * sidebar (library tree) | list pane | detail pane, with a status bar along
 * the bottom — and exposes mount points for the views. The shell is never
 * rebuilt on navigation; views repaint their own slice.
 *
 * Also owns the two sashes: dragging resizes the sidebar / detail pane, and
 * dragging below a threshold collapses it, exactly like the VS Code panel.
 *
 * @depends ui/dom, state/uiPrefs
 * @dependents library-page/index
 */
import { $ } from "../ui/dom";
import { loadPrefs, savePrefs } from "./state/uiPrefs";

export interface LibraryAppMounts {
  sidebar: HTMLElement;
  listHeader: HTMLElement;
  filterBar: HTMLElement;
  list: HTMLElement;
  detail: HTMLElement;
  statusBar: HTMLElement;
}

const SIDEBAR = { min: 160, max: 420, collapseAt: 110 };
const DETAIL = { min: 220, max: 620, collapseAt: 160 };

/** Builds the layout DOM, wires the sashes, and returns the view mounts. */
export function buildApp(root: HTMLElement): LibraryAppMounts {
  root.innerHTML = `
    <div class="app" id="app">
      <aside class="sidebar" id="sidebar" aria-label="Library"></aside>
      <div class="sash sash-sidebar" id="sidebarSash" title="Drag to resize"></div>
      <section class="list-pane" id="listPane">
        <div class="list-header" id="listHeader"></div>
        <div class="filter-bar" id="filterBar"></div>
        <div class="list-body" id="listBody"></div>
      </section>
      <div class="sash sash-detail" id="detailSash" title="Drag to resize"></div>
      <aside class="detail-pane" id="detailPane" aria-label="Paper details"></aside>
    </div>
    <footer class="status-bar" id="statusBar"></footer>
  `;

  const app = $("app", root);
  const sidebar = $("sidebar", root);
  const detail = $("detailPane", root);
  const prefs = loadPrefs();

  sidebar.style.width = `${prefs.sidebarWidth}px`;
  detail.style.width = `${prefs.detailWidth}px`;
  app.classList.toggle("sidebar-collapsed", prefs.sidebarCollapsed);
  app.classList.toggle("detail-collapsed", prefs.detailCollapsed);

  attachSash($("sidebarSash", root), {
    pane: sidebar,
    collapsedClass: "sidebar-collapsed",
    app,
    limits: SIDEBAR,
    widthFromPointer: (x) => x - app.getBoundingClientRect().left,
    persist: (width, collapsed) => savePrefs({ sidebarWidth: width, sidebarCollapsed: collapsed }),
  });
  attachSash($("detailSash", root), {
    pane: detail,
    collapsedClass: "detail-collapsed",
    app,
    limits: DETAIL,
    widthFromPointer: (x) => app.getBoundingClientRect().right - x,
    persist: (width, collapsed) => savePrefs({ detailWidth: width, detailCollapsed: collapsed }),
  });

  return {
    sidebar,
    listHeader: $("listHeader", root),
    filterBar: $("filterBar", root),
    list: $("listBody", root),
    detail,
    statusBar: $("statusBar", root),
  };
}

/** Toggles a pane's collapsed state and persists it. */
export function togglePane(which: "sidebar" | "detail"): boolean {
  const app = $("app");
  const cls = which === "sidebar" ? "sidebar-collapsed" : "detail-collapsed";
  const collapsed = app.classList.toggle(cls);
  if (which === "sidebar") savePrefs({ sidebarCollapsed: collapsed }); else savePrefs({ detailCollapsed: collapsed });
  return collapsed;
}

interface SashOptions {
  pane: HTMLElement;
  app: HTMLElement;
  collapsedClass: string;
  limits: { min: number; max: number; collapseAt: number };
  widthFromPointer: (clientX: number) => number;
  persist: (width: number, collapsed: boolean) => void;
}

function attachSash(sash: HTMLElement, o: SashOptions): void {
  let dragging = false;
  sash.addEventListener("mousedown", (e) => {
    dragging = true;
    sash.classList.add("dragging");
    document.body.classList.add("resizing");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const desired = o.widthFromPointer(e.clientX);
    if (desired < o.limits.collapseAt) { o.app.classList.add(o.collapsedClass); return; }
    o.app.classList.remove(o.collapsedClass);
    o.pane.style.width = `${Math.min(o.limits.max, Math.max(o.limits.min, desired))}px`;
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    sash.classList.remove("dragging");
    document.body.classList.remove("resizing");
    o.persist(parseInt(o.pane.style.width, 10) || o.limits.min, o.app.classList.contains(o.collapsedClass));
  });
  // Double-click restores a collapsed pane, the quickest way back once it is hidden.
  sash.addEventListener("dblclick", () => {
    o.app.classList.remove(o.collapsedClass);
    o.persist(parseInt(o.pane.style.width, 10) || o.limits.min, false);
  });
}
