/**
 * Renders the collections tree in the sidebar. Folders come from
 * {@link LibraryStore.folders}; selecting a folder publishes the change so
 * the paper list / breadcrumb pick it up. Expansion state lives in the view
 * (transient UX state, not worth promoting to the store).
 *
 * @depends storage FolderNode, state/libraryStore, views/emptyStateView
 * @dependents library-page/index
 */
import type { FolderNode } from "../../storage";
import type { LibraryStore } from "../state/libraryStore";
import { emptyState, escapeHtml } from "./emptyStateView";

const ROOT_PATH = "papers";

interface TreeContext {
  store: LibraryStore;
  expanded: Set<string>;
  body: HTMLElement;
}

/** Mounts the tree into the given container and subscribes to folder changes. */
export function mountSidebar(container: HTMLElement, store: LibraryStore): () => void {
  container.innerHTML = `
    <header class="pane__header">
      <span>Collections</span>
      <button id="new-root-folder" type="button" title="New folder at library root">+</button>
    </header>
    <ul class="tree" id="tree-body" role="tree"></ul>
  `;

  const body = container.querySelector<HTMLElement>("#tree-body");
  if (!body) throw new Error("Missing #tree-body");
  const ctx: TreeContext = { store, expanded: new Set([ROOT_PATH]), body };

  container.querySelector("#new-root-folder")?.addEventListener("click", () => {
    container.dispatchEvent(
      new CustomEvent("labshelf:new-folder", { bubbles: true, detail: { parent: ROOT_PATH } }),
    );
  });

  body.addEventListener("click", (e) => onClick(e, ctx));

  const unsubFolders = store.select((s) => s.folders, (folders) => render(ctx, folders));
  const unsubSelection = store.select(
    (s) => s.selectedFolder,
    () => render(ctx, store.get().folders),
  );

  return () => { unsubFolders(); unsubSelection(); };
}

function render(ctx: TreeContext, folders: FolderNode[]): void {
  const selected = ctx.store.get().selectedFolder;
  if (folders.length === 0) {
    ctx.body.innerHTML = `<li>${emptyState("No collections yet — capture a paper to begin.")}</li>`;
    return;
  }
  const rootNode: FolderNode = { name: "LIBRARY", path: ROOT_PATH, children: folders };
  ctx.body.innerHTML = renderNode(rootNode, 0, ctx.expanded, selected);
}

function renderNode(node: FolderNode, depth: number, expanded: Set<string>, selected: string): string {
  const isOpen = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const caret = hasChildren ? (isOpen ? "▾" : "▸") : "·";
  const caretClass = hasChildren ? "tree__caret" : "tree__caret tree__caret--leaf";
  const indent = 8 + depth * 12;
  const isSelected = node.path === selected;
  const label = depth === 0 ? "LIBRARY" : node.name.toUpperCase();
  const children = isOpen
    ? node.children.map((c) => renderNode(c, depth + 1, expanded, selected)).join("")
    : "";
  return `
    <li>
      <div class="tree__item"
           role="treeitem"
           data-path="${escapeHtml(node.path)}"
           data-expandable="${hasChildren}"
           aria-selected="${isSelected}"
           style="--indent:${indent}px">
        <span class="${caretClass}">${caret}</span>
        <span class="tree__label">${escapeHtml(label)}</span>
        <span class="tree__actions">
          <button class="tree__action" data-action="new" title="New subfolder">+</button>
          ${depth > 0 ? `<button class="tree__action" data-action="rename" title="Rename">✎</button>` : ""}
          ${depth > 0 ? `<button class="tree__action" data-action="delete" title="Delete">×</button>` : ""}
        </span>
      </div>
      ${children ? `<ul class="tree" role="group">${children}</ul>` : ""}
    </li>
  `;
}

function onClick(e: Event, ctx: TreeContext): void {
  const target = e.target as HTMLElement;
  const item = target.closest<HTMLElement>(".tree__item");
  if (!item) return;
  const path = item.dataset["path"] ?? ROOT_PATH;
  const action = target.dataset["action"];
  if (action === "new") {
    item.dispatchEvent(
      new CustomEvent("labshelf:new-folder", { bubbles: true, detail: { parent: path } }),
    );
    return;
  }
  if (action === "rename") {
    item.dispatchEvent(
      new CustomEvent("labshelf:rename-folder", { bubbles: true, detail: { path } }),
    );
    return;
  }
  if (action === "delete") {
    item.dispatchEvent(
      new CustomEvent("labshelf:delete-folder", { bubbles: true, detail: { path } }),
    );
    return;
  }
  if (target.classList.contains("tree__caret") && item.dataset["expandable"] === "true") {
    if (ctx.expanded.has(path)) ctx.expanded.delete(path);
    else ctx.expanded.add(path);
    render(ctx, ctx.store.get().folders);
    return;
  }
  ctx.store.set({ selectedFolder: path, selectedPaperId: null });
}
