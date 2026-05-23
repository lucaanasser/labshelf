/**
 * Renders the right-hand detail pane for the currently selected paper. Shows
 * title, status pills, bibliographic metadata, and primary actions (open PDF,
 * change status, delete). Actions dispatch CustomEvents picked up by the
 * paperController, keeping the view IO-free.
 *
 * @depends @labshelf/core PaperRecord, state/libraryStore, views/emptyStateView
 * @dependents library-page/index
 */
import type { PaperRecord } from "@labshelf/core";
import type { LibraryStore } from "../state/libraryStore";
import { emptyState, escapeHtml } from "./emptyStateView";

interface DetailContext {
  store: LibraryStore;
  container: HTMLElement;
}

/** Mounts the detail pane and returns an unsubscribe function. */
export function mountDetail(container: HTMLElement, store: LibraryStore): () => void {
  const ctx: DetailContext = { store, container };
  container.addEventListener("click", (e) => onClick(e, ctx));
  return store.select(
    (s) => ({ id: s.selectedPaperId, papers: s.papers } as const),
    ({ id, papers }) => {
      const paper = id ? papers.find((p) => p.id === id) : undefined;
      render(ctx, paper);
    },
  );
}

function render(ctx: DetailContext, paper: PaperRecord | undefined): void {
  if (!paper) {
    ctx.container.innerHTML = `
      <header class="pane__header"><span>Details</span></header>
      ${emptyState("Select a paper to inspect it.")}
    `;
    return;
  }

  const pills = [
    paper.doi ? `<span class="pill pill--ok">DOI</span>` : "",
    paper.url ? `<span class="pill">URL</span>` : "",
    paper.journal ? `<span class="pill pill--accent">${escapeHtml(paper.journal.toUpperCase())}</span>` : "",
  ].filter(Boolean).join(" ");

  const meta = renderMeta(paper);

  ctx.container.innerHTML = `
    <header class="pane__header"><span>Details</span></header>
    <section class="detail" data-id="${escapeHtml(paper.id)}">
      <h2 class="detail__title">${escapeHtml(paper.title)}</h2>
      <div class="detail__cite">${escapeHtml(paper.citeKey)}</div>
      <div class="detail__pills">${pills}</div>
      <div class="detail__section">${meta}</div>
      <div class="detail__actions">
        <button data-action="open-pdf" class="btn--accent">OPEN PDF</button>
        <button data-action="copy-cite">COPY CITE KEY</button>
        <button data-action="status-reading">MARK AS READING</button>
        <button data-action="status-done">MARK AS DONE</button>
        <button data-action="delete">DELETE</button>
      </div>
    </section>
  `;
}

function renderMeta(paper: PaperRecord): string {
  const rows: Array<[string, string | undefined]> = [
    ["Authors", paper.authors?.join(", ")],
    ["Year", paper.year ? String(paper.year) : undefined],
    ["Journal", paper.journal],
    ["Volume", paper.volume],
    ["Issue", paper.issue],
    ["Pages", paper.pages],
    ["DOI", paper.doi],
    ["URL", paper.url],
    ["Path", paper.path],
    ["Status", paper.status],
  ];
  return rows
    .filter(([, v]) => v && v.length > 0)
    .map(
      ([k, v]) => `
        <div class="detail__key">${escapeHtml(k)}</div>
        <div class="detail__val">${escapeHtml(v as string)}</div>
      `,
    )
    .join("");
}

function onClick(e: Event, ctx: DetailContext): void {
  const target = e.target as HTMLElement;
  const action = target.dataset["action"];
  if (!action) return;
  const id = ctx.store.get().selectedPaperId;
  if (!id) return;
  ctx.container.dispatchEvent(
    new CustomEvent("labshelf:paper-action", {
      bubbles: true,
      detail: { id, action },
    }),
  );
}
