/**
 * List-pane header: breadcrumb (library icon + path segments + count badge),
 * search box, and the toolbar — show-subfolders toggle, new subfolder,
 * "+ Add", toggle details. Same anatomy as the VS Code list panel header.
 * Crumbs are drop targets for paper moves.
 *
 * @depends ui/dom, ui/icons, state/libraryStore, state/derive, state/uiPrefs, events, views/dnd, app
 * @dependents library-page/index
 */
import { $, el, esc, tokenize } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { togglePane } from "../app";
import { emit } from "../events";
import { breadcrumbFor, listPapersUnder, papersInScope, statusCounts } from "../state/derive";
import type { LibraryStore } from "../state/libraryStore";
import { savePrefs } from "../state/uiPrefs";
import { makeDropTarget } from "./dnd";

/** Mounts the header and returns an unsubscribe function. */
export function mountListHeader(container: HTMLElement, store: LibraryStore): () => void {
  container.innerHTML = `
    <button class="ls-icon-btn sidebar-toggle" id="showSidebarBtn" title="Show library sidebar">${icon("panel-left")}</button>
    <nav class="breadcrumb" id="breadcrumb" aria-label="Folder path"></nav>
    <div class="ls-search" id="searchBox">
      ${icon("search")}
      <input id="searchInput" type="text" placeholder="Search title, author, year, keyword  ( / )" spellcheck="false" autocomplete="off" aria-label="Search papers"/>
      <button class="ls-search-clear" id="searchClear" title="Clear search (Esc)">${icon("x")}</button>
    </div>
    <button class="ls-icon-btn" id="includeSubBtn" title="Show papers from subfolders">${icon("layers")}</button>
    <button class="ls-icon-btn" id="newFolderBtn" title="New subfolder">${icon("folder-plus")}</button>
    <button class="ls-btn ls-btn-primary" id="addPaperBtn" title="Add a paper from an open tab">${icon("plus")}<span>Add</span></button>
    <button class="ls-icon-btn" id="toggleDetailBtn" title="Toggle details panel">${icon("panel-right")}</button>
  `;
  const search = $<HTMLInputElement>("searchInput", container);
  const searchBox = $("searchBox", container);
  const includeSubBtn = $<HTMLButtonElement>("includeSubBtn", container);
  const crumbs = $("breadcrumb", container);

  let timer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => store.set({ query: search.value }), 80);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { store.set({ query: "" }); search.value = ""; $("paperList").focus(); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "Enter") { $("paperList").focus(); e.preventDefault(); }
  });
  $("searchClear", container).addEventListener("click", () => { store.set({ query: "" }); search.value = ""; search.focus(); });
  includeSubBtn.addEventListener("click", () => {
    const includeSub = !store.get().includeSub;
    savePrefs({ includeSub });
    store.set({ includeSub });
  });
  $("newFolderBtn", container).addEventListener("click", () => emit("labshelf:new-folder", { parent: store.get().folder }));
  $("addPaperBtn", container).addEventListener("click", () => emit("labshelf:add-paper", {}));
  $("toggleDetailBtn", container).addEventListener("click", () => togglePane("detail"));
  $("showSidebarBtn", container).addEventListener("click", () => togglePane("sidebar"));

  return store.select(
    (s) => ({ folder: s.folder, folders: s.folders, papers: s.papers, query: s.query, status: s.status, includeSub: s.includeSub }),
    (slice) => {
      if (search.value !== slice.query) search.value = slice.query;
      searchBox.classList.toggle("has-query", slice.query.length > 0);
      includeSubBtn.classList.toggle("active", slice.includeSub);
      includeSubBtn.setAttribute("aria-pressed", String(slice.includeSub));

      const inFolder = listPapersUnder(slice.papers, slice.folder);
      const scope = papersInScope(inFolder, tokenize(slice.query), slice.includeSub);
      const counts = statusCounts(scope);
      const shown = slice.status === "all" ? scope.length : counts[slice.status];
      const narrowed = slice.query.length > 0 || slice.status !== "all";
      renderCrumbs(crumbs, store, slice.folder, narrowed ? `${shown} / ${inFolder.length}` : scope.length ? String(scope.length) : "");
    },
  );
}

function renderCrumbs(container: HTMLElement, store: LibraryStore, folder: string, count: string): void {
  const chain = breadcrumbFor(folder);
  const frag = document.createDocumentFragment();
  chain.forEach((node, i) => {
    const last = i === chain.length - 1;
    if (i > 0) frag.append(el("span", { class: "crumb-sep", html: icon("chevron-right") }));
    const b = el("button", {
      class: `crumb${last ? " current" : ""}`,
      type: "button",
      title: last ? node.label : `Go to ${node.label}`,
      html: `${node.isRoot ? icon("library") : ""}<span>${esc(node.label)}</span>`,
    });
    if (!last) {
      b.addEventListener("click", () => store.openFolder(node.path));
      makeDropTarget(b, node.path);
    }
    frag.append(b);
  });
  frag.append(el("span", { class: "ls-count", text: count }));
  container.replaceChildren(frag);
}
