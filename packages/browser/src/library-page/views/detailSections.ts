/**
 * HTML builders for the detail pane, in the VS Code panel's reading-triage
 * order: what the paper is (title, byline, venue), what you can do with it
 * (actions, status segment), then Abstract, Keywords, Info, the PDF attachment
 * when one exists — otherwise a "No PDF" empty state offering Find PDF / Attach
 * PDF — the note and tags attached when saving from the toolbar (read-only here
 * for now), and the not-yet-implemented Related section.
 *
 * @depends ui/dom, ui/icons, ui/pdfCopy, state/derive
 * @dependents views/detailPaneView
 */
import { esc } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { attachmentsHeading } from "../../ui/pdfCopy";
import { STATUSES, STATUS_LABEL, folderLabel } from "../state/derive";
import type { ListPaper } from "../state/derive";
import type { PaperStatus } from "@labshelf/core";

export const ABSTRACT_TRUNCATE_AT = 320;

function field(label: string, value: string, mono = false): string {
  return `<div class="detail-field"><div class="detail-label">${esc(label)}</div><div class="detail-value${mono ? " mono" : ""}">${esc(value)}</div></div>`;
}

export function section(id: string, title: string, body: string, collapsed: boolean, actions = ""): string {
  return `<div class="detail-section">` +
    `<div class="sec-head${collapsed ? " collapsed" : ""}" data-sec="${id}" role="button" aria-expanded="${!collapsed}">` +
      `<div class="sec-head-left"><span class="sec-chevron${collapsed ? " collapsed" : ""}">${icon("chevron-down")}</span><span>${esc(title)}</span></div>${actions}` +
    `</div>` +
    `<div class="sec-body${collapsed ? " hidden" : ""}" id="sec-${id}">${body}</div></div>`;
}

function muted(text: string): string {
  return `<div class="muted-note">${esc(text)}</div>`;
}

function soonBtn(title: string): string {
  return `<div class="sec-actions"><button class="ls-icon-btn" title="${esc(title)}" disabled>${icon("plus")}</button></div>`;
}

export function statusSeg(current: PaperStatus | null): string {
  return `<div class="status-seg" role="group" aria-label="Reading status">${STATUSES.map((st) =>
    `<button class="${current === st ? "on" : ""}" type="button" data-action="setStatus" data-status="${st}" aria-pressed="${current === st}"><span class="ls-dot s-${st}"></span>${STATUS_LABEL[st]}</button>`,
  ).join("")}</div>`;
}

/**
 * The action row. For a single paper the primary button is "Open PDF" when a
 * PDF exists, otherwise "Find PDF" (disabled with a spinner while a search is
 * in flight). A multi-selection has no Open/Find PDF.
 */
export function actionRow(single: boolean, hasPdf = true, busy = false): string {
  const primary = hasPdf
    ? `<button class="ls-btn ls-btn-primary" type="button" data-action="open-pdf">Open PDF</button>`
    : `<button class="ls-btn ls-btn-primary" type="button" data-action="find-pdf"${busy ? " disabled" : ""}>${busy ? `<span class="spin">${icon("sync")}</span><span>Searching…</span>` : "Find PDF"}</button>`;
  return `<div class="detail-action-row">` +
    (single ? `${primary}<button class="ls-btn" type="button" data-action="copy-cite">Copy Key</button>` : "") +
    `<button class="ls-btn${single ? "" : " ls-btn-primary"}" type="button" data-action="move">Move to…</button>` +
    (single ? `<button class="ls-btn ls-btn-danger" type="button" data-action="delete">Remove</button>` : "") +
    `</div>`;
}

/** Attachment section body: the single paper.pdf item, or the "No PDF" empty state. */
function attachBody(hasPdf: boolean, busy: boolean): string {
  if (hasPdf) {
    return `<div class="attach-item" data-action="open-pdf"><span class="sec-icon">${icon("file")}</span><span>paper.pdf</span></div>`;
  }
  if (busy) {
    return `<div class="attach-busy"><span class="spin">${icon("sync")}</span><span>Searching for the PDF…</span></div>`;
  }
  return `<div class="attach-empty">` +
    muted("No PDF attached") +
    `<div class="attach-actions">` +
      `<button class="ls-btn" type="button" data-action="find-pdf">${icon("search")}<span>Find PDF</span></button>` +
      `<button class="ls-btn" type="button" data-action="attach-pdf">${icon("paperclip")}<span>Attach PDF…</span></button>` +
    `</div>` +
  `</div>`;
}

function infoBody(p: ListPaper, openFolder: string): string {
  let html = field("Item Type", "Journal Article");
  for (const a of p.authors ?? []) html += field("Author", a);
  const pairs: Array<[string, string | number | undefined]> = [
    ["Publication", p.journal], ["Publisher", p.publisher], ["Date", p.year], ["Volume", p.volume],
    ["Issue", p.issue], ["Pages", p.pages], ["DOI", p.doi], ["ISSN", p.issn],
  ];
  for (const [k, v] of pairs) if (v) html += field(k, String(v));
  if (p.url) html += `<div class="detail-field"><div class="detail-label">URL</div><div class="detail-value"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></div></div>`;
  if (p.language) html += field("Language", p.language);
  html += field("Citation Key", p.citeKey, true);
  html += `<div class="detail-field"><div class="detail-label">Folder</div><div class="detail-value"><a href="#" data-action="goFolder">${esc(p.relFolder || folderLabel(openFolder))}</a></div></div>`;
  return html;
}

function abstractBody(p: ListPaper, open: boolean): string {
  if (!p.summary) return muted("No abstract available");
  const long = p.summary.length > ABSTRACT_TRUNCATE_AT;
  return `<div class="detail-abstract${long && !open ? " detail-abstract-truncated" : ""}">${esc(p.summary)}</div>` +
    (long ? `<button class="more-link" type="button" data-action="toggleAbstract">${open ? "Show less" : "Show more"}</button>` : "");
}

function keywordsBody(p: ListPaper): string {
  return `<div class="kw-list">${(p.keywords ?? []).map((k) =>
    `<button class="kw" type="button" data-action="searchKeyword" data-keyword="${esc(k)}" title="Search this keyword">${esc(k)}</button>`).join("")}</div>`;
}

function tagsBody(p: ListPaper): string {
  if (!p.tags?.length) return muted("No tags — add them when saving from the toolbar button");
  return `<div class="kw-list">${p.tags.map((t) =>
    `<button class="kw" type="button" data-action="searchKeyword" data-keyword="${esc(t)}" title="Search this tag">${icon("tag")}${esc(t)}</button>`).join("")}</div>`;
}

function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export interface DetailViewState {
  collapsed: Record<string, boolean>;
  abstractOpen: boolean;
  openFolder: string;
  /** A "Find PDF" search is in flight for this paper. */
  pdfBusy: boolean;
}

/** The full detail pane for a single paper. */
export function paperDetailHtml(p: ListPaper, v: DetailViewState): string {
  const venue = [p.journal ?? p.publisher, p.year].filter(Boolean).join(" · ");
  const c = (id: string): boolean => !!v.collapsed[id];
  return `<div class="detail-head">` +
      `<div class="detail-paper-title">${esc(p.title)}</div>` +
      (p.authors?.length ? `<div class="detail-byline">${esc(p.authors.join(", "))}</div>` : "") +
      (venue ? `<div class="detail-venue">${esc(venue)}</div>` : "") +
      actionRow(true, p.hasPdf, v.pdfBusy) + statusSeg(p.status) +
    `</div>` +
    section("abstract", "Abstract", abstractBody(p, v.abstractOpen), c("abstract")) +
    (p.keywords?.length ? section("keywords", "Keywords", keywordsBody(p), c("keywords")) : "") +
    section("info", "Info", infoBody(p, v.openFolder), c("info")) +
    section("attach", attachmentsHeading(p.hasPdf), attachBody(p.hasPdf, v.pdfBusy), c("attach")) +
    section("notes", p.note ? "1 Note" : "0 Notes", p.note ? `<div class="detail-note">${esc(p.note)}</div>` : muted("No note — add one when saving from the toolbar button"), c("notes"), soonBtn("Edit note (coming soon)")) +
    section("tags", countLabel(p.tags?.length ?? 0, "Tag"), tagsBody(p), c("tags"), soonBtn("Edit tags (coming soon)")) +
    section("related", "0 Related", muted("Related papers not yet implemented"), c("related"));
}

/** The pane for a multi-selection. */
export function multiDetailHtml(count: number): string {
  return `<div class="detail-head"><div class="detail-paper-title">${count} papers selected</div>` +
    `<div class="detail-byline">Drag them onto a folder, a subfolder chip or a path segment, or pick a destination.</div>` +
    actionRow(false) + statusSeg(null) + `</div>`;
}
