/**
 * Library tree in the sidebar, mirroring the VS Code tree view: an
 * "All Papers" root followed by the collection folders, each with its
 * recursive paper count. Every row opens in the list pane; the twistie
 * expands; hover reveals "new subfolder"; right-click opens the same context
 * menu the VS Code tree contributes. Rows accept paper drops.
 *
 * Expansion state is persisted through uiPrefs; the open folder's ancestors
 * are always expanded so the selection is never hidden.
 *
 * @depends ui/dom, ui/icons, ui/menu, state/libraryStore, state/derive, state/uiPrefs, events, views/dnd
 * @dependents library-page/index
 */
import { el, esc } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { showMenu } from "../../ui/menu";
import type { FolderNode } from "../../storage";
import { emit } from "../events";
import { ROOT, ROOT_LABEL, countPapersUnder, isUnder, parentDir } from "../state/derive";
import type { LibraryStore } from "../state/libraryStore";
import { loadPrefs, savePrefs } from "../state/uiPrefs";
import { makeDropTarget } from "./dnd";

interface Ctx {
  store: LibraryStore;
  tree: HTMLElement;
  expanded: Set<string>;
  focused: string | null;
}

/** Mounts the tree into the sidebar and returns an unsubscribe function. */
export function mountSidebar(container: HTMLElement, store: LibraryStore): () => void {
  container.innerHTML = `
    <div class="tree-head">
      <span class="ls-brand">${icon("logo")}<span>LabShelf</span></span>
    </div>
    <div class="tree-section" id="treeSection" role="button" aria-expanded="true">
      <div class="tree-section-left"><span class="twisty">${icon("chevron-down")}</span><span>Library</span></div>
      <div class="tree-actions">
        <button class="ls-icon-btn" id="treeNewFolder" title="New folder at library root">${icon("folder-plus")}</button>
        <button class="ls-icon-btn" id="treeCollapse" title="Collapse all">${icon("layers")}</button>
      </div>
    </div>
    <div class="tree" id="tree" role="tree" tabindex="0" aria-label="Library folders"></div>
  `;
  const tree = container.querySelector<HTMLElement>("#tree")!;
  const section = container.querySelector<HTMLElement>("#treeSection")!;
  const ctx: Ctx = { store, tree, expanded: new Set(loadPrefs().treeExpanded), focused: null };

  section.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".tree-actions")) return;
    const collapsed = section.classList.toggle("collapsed");
    section.setAttribute("aria-expanded", String(!collapsed));
  });
  container.querySelector("#treeNewFolder")!.addEventListener("click", () => emit("labshelf:new-folder", { parent: ROOT }));
  container.querySelector("#treeCollapse")!.addEventListener("click", () => { ctx.expanded.clear(); persist(ctx); render(ctx); });

  tree.addEventListener("click", (e) => onClick(e, ctx));
  tree.addEventListener("dblclick", (e) => onDblClick(e, ctx));
  tree.addEventListener("contextmenu", (e) => onContextMenu(e, ctx));
  tree.addEventListener("keydown", (e) => onKey(e, ctx));
  tree.addEventListener("focus", () => { if (!ctx.focused) ctx.focused = ctx.store.get().folder; paintFocus(ctx); });
  tree.addEventListener("blur", () => { ctx.focused = null; paintFocus(ctx); });

  return store.select(
    (s) => ({ folders: s.folders, folder: s.folder, papers: s.papers }),
    ({ folder }) => {
      // Reveal the open folder: expand its ancestors, as VS Code's tree.reveal does.
      for (let p = parentDir(folder); p !== ROOT && isUnder(p, ROOT); p = parentDir(p)) ctx.expanded.add(p);
      render(ctx);
    },
  );
}

function render(ctx: Ctx): void {
  const { folders, folder, papers } = ctx.store.get();
  const paths = papers.map((p) => p.path);
  const frag = document.createDocumentFragment();
  frag.append(row(ctx, { name: ROOT_LABEL, path: ROOT, children: [] }, 0, countPapersUnder(paths, ROOT), folder, true));
  const walk = (nodes: FolderNode[], depth: number): void => {
    for (const node of nodes) {
      frag.append(row(ctx, node, depth, countPapersUnder(paths, node.path), folder, false));
      if (node.children.length && ctx.expanded.has(node.path)) walk(node.children, depth + 1);
    }
  };
  walk(folders, 0);
  if (folders.length === 0) {
    frag.append(el("div", { class: "tree-empty", text: "No folders yet. Folders you create here also appear in the VS Code extension after the next sync." }));
  }
  ctx.tree.replaceChildren(frag);
  paintFocus(ctx);
}

function row(ctx: Ctx, node: FolderNode, depth: number, count: number, selected: string, isRoot: boolean): HTMLElement {
  const hasChildren = node.children.length > 0;
  const open = ctx.expanded.has(node.path);
  const guides = Array.from({ length: depth }, (_, i) => `<span class="guide" style="left:${16 + i * 8}px"></span>`).join("");
  const r = el("div", {
    class: `tree-row${node.path === selected ? " selected" : ""}${hasChildren && !open ? " collapsed" : ""}`,
    role: "treeitem",
    "aria-selected": String(node.path === selected),
    "aria-expanded": hasChildren ? String(open) : undefined,
    "data-path": node.path,
    "data-root": isRoot ? "1" : undefined,
    style: `--depth:${depth}`,
    title: isRoot ? "Every paper in the library" : node.path.slice(ROOT.length + 1),
    html: `${guides}<span class="tree-twisty${hasChildren ? "" : " leaf"}">${icon("chevron-down")}</span>` +
      `<span class="tree-icon">${icon(isRoot ? "library" : "folder")}</span>` +
      `<span class="tree-label">${esc(node.name)}</span>` +
      (count > 0 ? `<span class="tree-count">${count}</span>` : "") +
      `<span class="tree-row-actions"><button class="ls-icon-btn" data-action="new" title="New subfolder" tabindex="-1">${icon("folder-plus")}</button></span>`,
  });
  r.draggable = false;
  makeDropTarget(r, node.path);
  return r;
}

function paintFocus(ctx: Ctx): void {
  const active = document.activeElement === ctx.tree;
  ctx.tree.querySelectorAll<HTMLElement>(".tree-row").forEach((r) => {
    r.classList.toggle("focused", active && r.dataset["path"] === ctx.focused);
  });
  if (active) ctx.tree.querySelector(".tree-row.focused")?.scrollIntoView({ block: "nearest" });
}

function persist(ctx: Ctx): void {
  savePrefs({ treeExpanded: [...ctx.expanded] });
}

function toggle(ctx: Ctx, path: string): void {
  if (ctx.expanded.has(path)) ctx.expanded.delete(path); else ctx.expanded.add(path);
  persist(ctx);
  render(ctx);
}

function rowAt(e: Event): HTMLElement | null {
  return (e.target as HTMLElement).closest<HTMLElement>(".tree-row");
}

function onClick(e: MouseEvent, ctx: Ctx): void {
  const r = rowAt(e);
  if (!r) return;
  const path = r.dataset["path"] ?? ROOT;
  const target = e.target as HTMLElement;
  ctx.focused = path;
  if (target.closest("[data-action='new']")) { emit("labshelf:new-folder", { parent: path }); return; }
  if (target.closest(".tree-twisty") && r.getAttribute("aria-expanded") !== null) { toggle(ctx, path); return; }
  ctx.store.openFolder(path);
  // Clicking a collapsed parent opens it *and* expands it, as VS Code does.
  if (r.getAttribute("aria-expanded") === "false") { ctx.expanded.add(path); persist(ctx); render(ctx); }
}

function onDblClick(e: MouseEvent, ctx: Ctx): void {
  const r = rowAt(e);
  if (!r || r.dataset["root"]) return;
  emit("labshelf:rename-folder", { path: r.dataset["path"]! });
}

function onContextMenu(e: MouseEvent, ctx: Ctx): void {
  const r = rowAt(e);
  if (!r) return;
  e.preventDefault();
  const path = r.dataset["path"] ?? ROOT;
  const isRoot = !!r.dataset["root"];
  ctx.focused = path;
  paintFocus(ctx);
  showMenu({ x: e.clientX, y: e.clientY }, [
    { label: "Open", icon: "list", onSelect: () => ctx.store.openFolder(path) },
    { label: "New Subfolder…", icon: "folder-plus", onSelect: () => emit("labshelf:new-folder", { parent: path }) },
    "separator",
    { label: "Rename…", icon: "edit", disabled: isRoot, hint: "F2", onSelect: () => emit("labshelf:rename-folder", { path }) },
    { label: "Delete Folder…", icon: "trash", disabled: isRoot, danger: true, onSelect: () => emit("labshelf:delete-folder", { path }) },
  ]);
}

function onKey(e: KeyboardEvent, ctx: Ctx): void {
  const rows = Array.from(ctx.tree.querySelectorAll<HTMLElement>(".tree-row"));
  const paths = rows.map((r) => r.dataset["path"] ?? ROOT);
  let idx = ctx.focused ? paths.indexOf(ctx.focused) : -1;
  if (idx === -1) idx = Math.max(0, paths.indexOf(ctx.store.get().folder));
  const current = rows[idx];
  const path = paths[idx] ?? ROOT;
  const expandable = current?.getAttribute("aria-expanded") !== null;
  const open = current?.getAttribute("aria-expanded") === "true";

  if (e.key === "ArrowDown") { ctx.focused = paths[Math.min(paths.length - 1, idx + 1)] ?? path; }
  else if (e.key === "ArrowUp") { ctx.focused = paths[Math.max(0, idx - 1)] ?? path; }
  else if (e.key === "Home") { ctx.focused = paths[0] ?? ROOT; }
  else if (e.key === "End") { ctx.focused = paths[paths.length - 1] ?? ROOT; }
  else if (e.key === "ArrowRight") { if (expandable && !open) { ctx.expanded.add(path); persist(ctx); render(ctx); } else if (open) ctx.focused = paths[idx + 1] ?? path; }
  else if (e.key === "ArrowLeft") { if (open) { ctx.expanded.delete(path); persist(ctx); render(ctx); } else if (path !== ROOT) ctx.focused = parentDir(path) === ROOT ? ROOT : parentDir(path); }
  else if (e.key === "Enter" || e.key === " ") { ctx.store.openFolder(path); }
  else if (e.key === "F2" && path !== ROOT) { emit("labshelf:rename-folder", { path }); }
  else if ((e.key === "Delete" || e.key === "Backspace") && path !== ROOT) { emit("labshelf:delete-folder", { path }); }
  else return;
  e.preventDefault();
  paintFocus(ctx);
}
