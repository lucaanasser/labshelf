/**
 * Detail pane: renders the selected paper (or a multi-selection summary) and
 * routes its buttons to store changes or typed intents. Section collapse
 * state is persisted through uiPrefs, like the VS Code webview's state.
 *
 * @depends ui/dom, state/libraryStore, state/derive, state/uiPrefs, events, views/detailSections
 * @dependents library-page/index
 */
import type { PaperStatus } from "@labshelf/core";
import { $ } from "../../ui/dom";
import { emit } from "../events";
import type { PaperAction } from "../events";
import { listPapersUnder } from "../state/derive";
import type { LibraryStore } from "../state/libraryStore";
import { loadPrefs, savePrefs } from "../state/uiPrefs";
import { multiDetailHtml, paperDetailHtml } from "./detailSections";

interface Ctx {
  store: LibraryStore;
  pane: HTMLElement;
  collapsed: Record<string, boolean>;
  abstractOpen: boolean;
  lastKey: string;
}

/** Mounts the detail pane and returns an unsubscribe function. */
export function mountDetailPane(container: HTMLElement, store: LibraryStore): () => void {
  const ctx: Ctx = { store, pane: container, collapsed: loadPrefs().secCollapsed, abstractOpen: false, lastKey: "" };
  container.addEventListener("click", (e) => onClick(e, ctx));
  return store.select(
    (s) => ({ selected: s.selected, papers: s.papers, folder: s.folder, pdfDirs: s.pdfDirs, pdfBusy: s.pdfBusy }),
    ({ selected }) => {
      // A new selection starts with the abstract folded again.
      const key = [...selected].sort().join("|");
      if (key !== ctx.lastKey) { ctx.abstractOpen = false; ctx.lastKey = key; }
      render(ctx);
    },
  );
}

function render(ctx: Ctx): void {
  const s = ctx.store.get();
  const ids = [...s.selected];
  if (ids.length === 0) {
    ctx.pane.innerHTML = `<div class="detail-placeholder">Select a paper to see details</div>`;
    return;
  }
  if (ids.length > 1) { ctx.pane.innerHTML = multiDetailHtml(ids.length); return; }
  const paper = listPapersUnder(s.papers, "papers", s.pdfDirs).find((p) => p.id === ids[0]);
  if (!paper) { ctx.pane.innerHTML = ""; return; }
  const scroll = ctx.pane.scrollTop;
  ctx.pane.innerHTML = paperDetailHtml(paper, { collapsed: ctx.collapsed, abstractOpen: ctx.abstractOpen, openFolder: s.folder, pdfBusy: s.pdfBusy.has(paper.id) });
  ctx.pane.scrollTop = scroll;
}

function onClick(e: MouseEvent, ctx: Ctx): void {
  const target = e.target as HTMLElement;
  const head = target.closest<HTMLElement>(".sec-head");
  if (head) { toggleSection(ctx, head); return; }

  const el = target.closest<HTMLElement>("[data-action]");
  if (!el) return;
  e.preventDefault();
  const ids = [...ctx.store.get().selected];
  const id = ids[0];
  if (!id) return;
  switch (el.dataset["action"]) {
    case "setStatus": emit("labshelf:set-status", { ids, status: el.dataset["status"] as PaperStatus }); return;
    case "goFolder": {
      const paper = ctx.store.get().papers.find((p) => p.id === id);
      if (paper) ctx.store.openFolder(paper.path.slice(0, paper.path.lastIndexOf("/")));
      return;
    }
    case "toggleAbstract": ctx.abstractOpen = !ctx.abstractOpen; render(ctx); return;
    case "searchKeyword": ctx.store.set({ status: "all", query: (el.dataset["keyword"] ?? "").toLowerCase() }); $("searchInput").focus(); return;
    case "move": emit("labshelf:paper-action", { ids, action: "move" }); return;
    default: emit("labshelf:paper-action", { ids: [id], action: el.dataset["action"] as PaperAction });
  }
}

function toggleSection(ctx: Ctx, head: HTMLElement): void {
  const sec = head.dataset["sec"]!;
  const closed = !ctx.collapsed[sec];
  ctx.collapsed = { ...ctx.collapsed, [sec]: closed };
  savePrefs({ secCollapsed: ctx.collapsed });
  head.classList.toggle("collapsed", closed);
  head.setAttribute("aria-expanded", String(!closed));
  head.querySelector(".sec-chevron")?.classList.toggle("collapsed", closed);
  ctx.pane.querySelector(`#sec-${sec}`)?.classList.toggle("hidden", closed);
}
