/**
 * Renders the paper list table in the main pane. Subscribes to the papers,
 * search and selectedPaperId slices and only repaints when one of them
 * changes. Filtering by search query happens in this view so the store stays
 * the raw record set for the selected folder.
 *
 * @depends @labshelf/core PaperRecord, state/libraryStore, views/emptyStateView
 * @dependents library-page/index
 */
import type { PaperRecord } from "@labshelf/core";
import type { LibraryStore } from "../state/libraryStore";
import { emptyState, escapeHtml } from "./emptyStateView";

interface ListContext {
  store: LibraryStore;
  body: HTMLElement;
}

interface ListSlice {
  papers: PaperRecord[];
  search: string;
  selectedPaperId: string | null;
  selectedFolder: string;
}

/** Mounts the paper list and returns an unsubscribe function. */
export function mountList(container: HTMLElement, store: LibraryStore): () => void {
  container.innerHTML = `
    <header class="pane__header">
      <span id="list-title">Papers</span>
      <span class="muted" id="list-count">0</span>
    </header>
    <div id="list-body"></div>
  `;
  const body = container.querySelector<HTMLElement>("#list-body");
  if (!body) throw new Error("Missing #list-body");
  const ctx: ListContext = { store, body };

  body.addEventListener("click", (e) => onClick(e, ctx));

  const dispose = store.select<ListSlice>(
    (s) => ({
      papers: s.papers,
      search: s.search,
      selectedPaperId: s.selectedPaperId,
      selectedFolder: s.selectedFolder,
    }),
    (slice) => render(ctx, slice),
  );
  return dispose;
}

function render(ctx: ListContext, slice: ListSlice): void {
  const filtered = filterPapers(slice.papers, slice.search);
  const titleEl = document.getElementById("list-title");
  if (titleEl) titleEl.textContent = folderLabel(slice.selectedFolder);
  const countEl = document.getElementById("list-count");
  if (countEl) countEl.textContent = `${filtered.length} PAPER${filtered.length === 1 ? "" : "S"}`;

  if (filtered.length === 0) {
    ctx.body.innerHTML = emptyState(
      slice.search ? "No papers match this search." : "Empty folder — capture a paper or sync the library.",
    );
    return;
  }
  ctx.body.innerHTML = `
    <table class="list">
      <thead>
        <tr>
          <th>Title / Authors</th>
          <th>Cite Key</th>
          <th>Year</th>
          <th>Folder</th>
          <th class="list__col-status">Status</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((p) => renderRow(p, slice.selectedPaperId, slice.selectedFolder)).join("")}
      </tbody>
    </table>
  `;
}

function renderRow(p: PaperRecord, selectedId: string | null, folderRoot: string): string {
  const authors = p.authors?.length ? p.authors.slice(0, 3).join(", ") : "—";
  const year = p.year ? String(p.year) : "—";
  const sub = p.path.startsWith(folderRoot + "/") ? p.path.slice(folderRoot.length + 1) : p.path;
  const folder = sub.split("/").slice(0, -1).join("/") || "—";
  const status = statusPill(p.status);
  const sel = p.id === selectedId ? "true" : "false";
  return `
    <tr data-id="${escapeHtml(p.id)}" aria-selected="${sel}">
      <td>
        <div class="list__title">${escapeHtml(p.title)}</div>
        <div class="list__authors">${escapeHtml(authors)}</div>
      </td>
      <td class="list__cite">${escapeHtml(p.citeKey)}</td>
      <td class="list__year">${escapeHtml(year)}</td>
      <td class="list__added">${escapeHtml(folder.toUpperCase())}</td>
      <td class="list__col-status">${status}</td>
    </tr>
  `;
}

function statusPill(status: PaperRecord["status"]): string {
  const label = status.toUpperCase();
  const cls = status === "done" ? "pill pill--ok" : status === "reading" ? "pill pill--accent" : "pill";
  return `<span class="${cls}">${label}</span>`;
}

function folderLabel(path: string): string {
  if (path === "papers" || path === "") return "LIBRARY";
  return path.split("/").pop()!.toUpperCase();
}

function filterPapers(papers: PaperRecord[], search: string): PaperRecord[] {
  const sorted = [...papers].sort((a, b) => a.title.localeCompare(b.title));
  if (!search.trim()) return sorted;
  const q = search.toLowerCase();
  return sorted.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      p.citeKey.toLowerCase().includes(q) ||
      p.authors?.some((a) => a.toLowerCase().includes(q)),
  );
}

function onClick(e: Event, ctx: ListContext): void {
  const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
  if (!row) return;
  const id = row.dataset["id"] ?? null;
  ctx.store.set({ selectedPaperId: id });
}
