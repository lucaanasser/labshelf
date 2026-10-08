/**
 * Paper list: sortable column heads and one row per paper in scope. Owns
 * sorting, single / range / toggle selection, the keyboard model of the
 * VS Code panel (arrows, Home/End, Enter opens, Cmd/Ctrl+A, Esc clears
 * filters, type-to-search, `/` focuses search) and paper drag-and-drop.
 *
 * Rows are rebuilt only when the data, filters or sort change; selection
 * changes just toggle classes, so scroll position and focus survive.
 *
 * @depends ui/dom, ui/icons, state/libraryStore, state/derive, state/uiPrefs, events, views/paperRow, views/dnd
 * @dependents library-page/index
 */
import { $, el, tokenize } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { emit } from "../events";
import { folderLabel, listPapersUnder, papersInScope, sortPapers } from "../state/derive";
import type { LibraryStore, SortKey } from "../state/libraryStore";
import { savePrefs } from "../state/uiPrefs";
import { endPaperDrag, startPaperDrag } from "./dnd";
import { buildEmptyState, buildPaperRow } from "./paperRow";

const COLUMNS: Array<{ key: SortKey; label: string; cls?: string }> = [
  { key: "title", label: "Title" }, { key: "creator", label: "Creator" }, { key: "year", label: "Year" },
  { key: "publication", label: "Publication", cls: "col-pub" }, { key: "status", label: "Status" },
];

interface Ctx {
  store: LibraryStore;
  list: HTMLElement;
  heads: HTMLElement;
  order: string[];
  expanded: Set<string>;
  lastFolder: string | null;
}

/** Mounts the list and returns an unsubscribe function. */
export function mountPaperList(container: HTMLElement, store: LibraryStore): () => void {
  container.innerHTML = `
    <div class="col-heads" id="colHeads"><div></div><div></div>${COLUMNS.map((c) =>
      `<div class="col-head sortable ${c.cls ?? ""}" data-sort="${c.key}">${c.label}<span class="sort-ind">${icon("chevron-down")}</span></div>`).join("")}
    </div>
    <div class="paper-list" id="paperList" tabindex="0" role="listbox" aria-multiselectable="true"><div class="list-loading">Loading…</div></div>
  `;
  const ctx: Ctx = { store, list: $("paperList", container), heads: $("colHeads", container), order: [], expanded: new Set(), lastFolder: null };

  ctx.heads.querySelectorAll<HTMLElement>(".sortable").forEach((h) => h.addEventListener("click", () => {
    const key = h.dataset["sort"] as SortKey;
    const s = store.get();
    const patch = s.sortKey === key ? { sortDir: (-s.sortDir) as 1 | -1 } : { sortKey: key, sortDir: 1 as const };
    savePrefs(patch);
    store.set(patch);
  }));
  const onKey = (e: KeyboardEvent): void => onKeydown(e, ctx);
  document.addEventListener("keydown", onKey);

  const unsubRows = store.select(
    (s) => ({ folder: s.folder, papers: s.papers, query: s.query, status: s.status, sortKey: s.sortKey, sortDir: s.sortDir, includeSub: s.includeSub, loading: s.loading, pdfDirs: s.pdfDirs }),
    () => render(ctx),
  );
  const unsubSel = store.select((s) => ({ selected: s.selected, cursor: s.cursor }), () => paintSelection(ctx));
  return () => { unsubRows(); unsubSel(); document.removeEventListener("keydown", onKey); };
}

function render(ctx: Ctx): void {
  const s = ctx.store.get();
  const toks = tokenize(s.query);
  const inFolder = listPapersUnder(s.papers, s.folder, s.pdfDirs);
  const scope = papersInScope(inFolder, toks, s.includeSub);
  const papers = sortPapers(s.status === "all" ? scope : scope.filter((p) => p.status === s.status), s.sortKey, s.sortDir);

  ctx.heads.querySelectorAll<HTMLElement>(".sortable").forEach((h) => {
    const on = h.dataset["sort"] === s.sortKey;
    h.classList.toggle("sorted", on);
    h.classList.toggle("asc", on && s.sortDir === 1);
  });

  const handlers = {
    onClick: (id: string, e: MouseEvent) => clickPaper(ctx, id, e),
    onOpen: (id: string) => emit("labshelf:paper-action", { ids: [id], action: "open-pdf" }),
    onDragStart: (id: string, e: DragEvent) => {
      if (!ctx.store.get().selected.has(id)) ctx.store.selectOnly(id);
      const ids = [...ctx.store.get().selected];
      startPaperDrag(e, ids, papers.find((p) => p.id === id)?.title ?? id);
      ctx.list.querySelectorAll(".paper-row").forEach((r) => r.classList.toggle("dragging", ids.includes((r as HTMLElement).dataset["id"] ?? "")));
    },
    onDragEnd: () => { endPaperDrag(); ctx.list.querySelectorAll(".dragging").forEach((r) => r.classList.remove("dragging")); },
    isExpanded: (id: string) => ctx.expanded.has(id),
    setExpanded: (id: string, open: boolean) => { if (open) ctx.expanded.add(id); else ctx.expanded.delete(id); },
  };

  const frag = document.createDocumentFragment();
  ctx.order = papers.map((p) => p.id);
  for (const p of papers) frag.append(buildPaperRow(p, toks, ctx.store, handlers));
  if (papers.length === 0) {
    frag.append(s.loading && s.papers.length === 0
      ? el("div", { class: "list-loading", text: "Loading…" })
      : buildEmptyState({
        narrowed: toks.length > 0 || s.status !== "all",
        onlyNested: inFolder.length > 0,
        folderLabel: folderLabel(s.folder),
        onClearFilters: () => { ctx.store.set({ status: "all", query: "" }); $("searchInput").focus(); },
        onShowSubfolders: () => { savePrefs({ includeSub: true }); ctx.store.set({ includeSub: true }); },
        onAdd: () => emit("labshelf:add-paper", {}),
      }));
  }

  const folderChanged = ctx.lastFolder !== s.folder;
  const scroll = ctx.list.scrollTop;
  ctx.list.replaceChildren(frag);
  ctx.list.scrollTop = folderChanged ? 0 : scroll;
  ctx.lastFolder = s.folder;
  if (s.cursor && !ctx.order.includes(s.cursor)) {
    const alive = new Set(ctx.order);
    const selected = new Set([...s.selected].filter((id) => alive.has(id)));
    ctx.store.set({ selected, cursor: null, anchor: selected.size ? s.anchor : null });
  }
  paintSelection(ctx);
  if (folderChanged && document.activeElement !== $("searchInput") && !document.querySelector(".ls-scrim")) ctx.list.focus();
}

function paintSelection(ctx: Ctx): void {
  const { selected, cursor } = ctx.store.get();
  ctx.list.querySelectorAll<HTMLElement>(".paper-row").forEach((r) => {
    const id = r.dataset["id"] ?? "";
    r.classList.toggle("selected", selected.has(id));
    r.classList.toggle("cursor", id === cursor);
    r.setAttribute("aria-selected", String(selected.has(id)));
  });
}

function clickPaper(ctx: Ctx, id: string, e: MouseEvent): void {
  if (e.shiftKey && ctx.store.get().anchor) ctx.store.selectRange(ctx.order, id);
  else if (e.metaKey || e.ctrlKey) ctx.store.toggleSelected(id);
  else ctx.store.selectOnly(id);
}

function moveCursor(ctx: Ctx, delta: number, extend: boolean): void {
  if (ctx.order.length === 0) return;
  const s = ctx.store.get();
  let idx = s.cursor ? ctx.order.indexOf(s.cursor) : -1;
  idx = idx === -1 ? (delta > 0 ? 0 : ctx.order.length - 1) : Math.min(ctx.order.length - 1, Math.max(0, idx + delta));
  const id = ctx.order[idx]!;
  if (extend && s.anchor) ctx.store.selectRange(ctx.order, id); else ctx.store.selectOnly(id);
  ctx.list.querySelector(`.paper-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
}

function onKeydown(e: KeyboardEvent, ctx: Ctx): void {
  const active = document.activeElement as HTMLElement | null;
  const mod = e.metaKey || e.ctrlKey;
  if (document.querySelector(".ls-scrim")) return;                        // a menu / dialog owns the keyboard
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
  if (active && active.closest(".tree")) return;                          // the tree handles its own keys
  if (active && active.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
  const s = ctx.store.get();

  if (e.key === "/" || (mod && e.key === "f")) { const search = $<HTMLInputElement>("searchInput"); search.focus(); search.select(); }
  else if (e.key === "ArrowDown") moveCursor(ctx, 1, e.shiftKey);
  else if (e.key === "ArrowUp" && e.altKey) { if (s.folder.includes("/")) ctx.store.openFolder(s.folder.slice(0, s.folder.lastIndexOf("/"))); }
  else if (e.key === "ArrowUp") moveCursor(ctx, -1, e.shiftKey);
  else if (e.key === "Home") { ctx.store.set({ cursor: null }); moveCursor(ctx, 1, false); }
  else if (e.key === "End") { ctx.store.set({ cursor: null }); moveCursor(ctx, -1, false); }
  else if (e.key === "Enter") { if (s.cursor) emit("labshelf:paper-action", { ids: [s.cursor], action: "open-pdf" }); }
  else if (e.key === "Escape") { if (s.query || s.status !== "all") ctx.store.set({ status: "all", query: "" }); else ctx.store.clearSelection(); }
  else if (mod && e.key === "a") ctx.store.set({ selected: new Set(ctx.order) });
  else if ((e.key === "Delete" || e.key === "Backspace") && s.selected.size) emit("labshelf:paper-action", { ids: [...s.selected], action: "delete" });
  else if (e.key.length === 1 && !mod && !e.altKey) { $<HTMLInputElement>("searchInput").focus(); return; } // type-to-search: the key lands in the box
  else return;
  e.preventDefault();
}
