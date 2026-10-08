/**
 * Row and empty-state builders for the paper list. A row is the VS Code list
 * panel's `.paper-row`: a twistie and a "paper.pdf" child row only when the
 * paper has a PDF (otherwise a hidden twistie cell keeps the grid aligned and a
 * muted file-minus type icon marks "No PDF attached"), the title with a
 * location chip when the paper sits in a subfolder, creator, year, publication,
 * and a status badge that cycles on click.
 *
 * @depends ui/dom, ui/icons, state/derive, events, views/dnd
 * @dependents views/paperListView
 */
import { el, esc, highlight } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { emit } from "../events";
import { STATUS_LABEL, fmtCreator, nextStatus } from "../state/derive";
import type { ListPaper } from "../state/derive";
import type { LibraryStore } from "../state/libraryStore";

export interface RowHandlers {
  onClick: (id: string, e: MouseEvent) => void;
  onOpen: (id: string) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  isExpanded: (id: string) => boolean;
  setExpanded: (id: string, open: boolean) => void;
}

/** Builds one paper row. */
export function buildPaperRow(p: ListPaper, toks: string[], store: LibraryStore, h: RowHandlers): HTMLElement {
  // Only a paper with a PDF can expand; a PDF-less row never shows children.
  const expanded = p.hasPdf && h.isExpanded(p.id);
  const creator = fmtCreator(p.authors);
  const venue = p.journal ?? p.publisher ?? "";
  const chip = p.relFolder ? `<span class="loc-chip" title="Go to ${esc(p.relFolder)}">${highlight(p.relFolder, toks)}</span>` : "";
  const row = el("div", { class: `paper-row${expanded ? " expanded" : ""}${p.hasPdf ? "" : " no-pdf"}`, "data-id": p.id });
  row.draggable = true;
  // A hidden leaf cell keeps the 7-column grid aligned when there is no twistie.
  const twistie = p.hasPdf
    ? `<div class="expand-btn${expanded ? "" : " collapsed"}" title="Attachments">${icon("chevron-down")}</div>`
    : `<div class="expand-btn leaf" aria-hidden="true"></div>`;
  const typeIcon = p.hasPdf
    ? `<div class="paper-type-icon">${icon("file")}</div>`
    : `<div class="paper-type-icon" title="No PDF attached">${icon("file-minus")}</div>`;
  row.innerHTML =
    `<div class="paper-row-main">` +
      twistie +
      typeIcon +
      `<div class="col-title title-cell" title="${esc(p.title)}"><span class="title-text">${highlight(p.title, toks)}</span>${chip}</div>` +
      `<div class="col-meta" title="${esc((p.authors ?? []).join(", "))}">${highlight(creator, toks)}</div>` +
      `<div class="col-meta">${p.year ? highlight(p.year, toks) : ""}</div>` +
      `<div class="col-meta col-pub" title="${esc(venue)}">${highlight(venue, toks)}</div>` +
      `<div class="col-meta">${badgeHtml(p)}</div>` +
    `</div>` +
    (p.hasPdf
      ? `<div class="paper-children">` +
          `<div class="child-row"><div></div><div class="paper-type-icon">${icon("file")}</div><div>paper.pdf</div><div></div><div></div><div class="col-pub"></div><div></div></div>` +
        `</div>`
      : "");

  // Wire the twistie only when it is real (a paper with a PDF); the leaf has no handler.
  const expandBtn = row.querySelector<HTMLElement>(".expand-btn:not(.leaf)");
  expandBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = row.classList.toggle("expanded");
    expandBtn.classList.toggle("collapsed", !open);
    h.setExpanded(p.id, open);
  });
  const main = row.querySelector<HTMLElement>(".paper-row-main")!;
  main.addEventListener("click", (e) => h.onClick(p.id, e));
  main.addEventListener("dblclick", () => h.onOpen(p.id));
  // The child row is conditional, so guard the listener (it throws otherwise).
  row.querySelector(".child-row")?.addEventListener("click", (e) => { e.stopPropagation(); h.onOpen(p.id); });
  const badge = row.querySelector<HTMLElement>("[data-cycle]")!;
  badge.addEventListener("click", (e) => { e.stopPropagation(); emit("labshelf:set-status", { ids: [p.id], status: nextStatus(p.status) }); });
  badge.addEventListener("dblclick", (e) => e.stopPropagation());
  row.querySelector(".loc-chip")?.addEventListener("click", (e) => { e.stopPropagation(); store.openFolder(p.folderPath); });
  row.addEventListener("dragstart", (e) => h.onDragStart(p.id, e));
  row.addEventListener("dragend", h.onDragEnd);
  return row;
}

function badgeHtml(p: ListPaper): string {
  return `<button class="ls-badge ls-badge-${esc(p.status)}" data-cycle="1" title="Click to mark as ${STATUS_LABEL[nextStatus(p.status)]}">${esc(STATUS_LABEL[p.status] ?? p.status)}</button>`;
}

export interface EmptyStateOptions {
  narrowed: boolean;
  onlyNested: boolean;
  folderLabel: string;
  onClearFilters: () => void;
  onShowSubfolders: () => void;
  onAdd: () => void;
}

/** Empty state with the three-way copy of the VS Code panel. */
export function buildEmptyState(o: EmptyStateOptions): HTMLElement {
  const box = el("div", { class: "ls-empty" });
  if (o.narrowed) {
    box.innerHTML = `<div class="ls-empty-icon">${icon("search")}</div><div class="ls-empty-text">No papers match in ${esc(o.folderLabel)}</div>` +
      `<button class="ls-btn" type="button">Clear filters</button>`;
    box.querySelector("button")!.addEventListener("click", o.onClearFilters);
    return box;
  }
  box.innerHTML = `<div class="ls-empty-icon">${icon("book")}</div>` +
    `<div class="ls-empty-text">${o.onlyNested ? "All papers here are inside subfolders" : "No papers here yet"}</div>` +
    `<button class="ls-btn ls-btn-primary" type="button">${o.onlyNested ? "Show papers from subfolders" : `${icon("plus")}<span>Add a paper</span>`}</button>` +
    (o.onlyNested ? "" : `<div class="ls-empty-hint">Open the paper's page in a tab and use the LabShelf toolbar button, or click Add to pick one of your open tabs.</div>`);
  box.querySelector("button")!.addEventListener("click", o.onlyNested ? o.onShowSubfolders : o.onAdd);
  return box;
}
