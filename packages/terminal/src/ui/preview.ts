/**
 * Content of the preview pane (right column), as styled lines: a paper's Info / Abstract / Notes / BibTeX tabs, or a
 * summary of the hovered folder. Pure functions of the snapshot and the sidecar, so tests render them without a
 * terminal.
 */
import { type Annotation, type PaperRecord, cleanQuote, type PaperData } from "@labshelf/core";

import type { CollectionNode, LibrarySnapshot, PaperEntry } from "../library/index.js";
import type { Style } from "../tui/screen.js";
import { wrap } from "../tui/text.js";
import { formatBytes, shortAuthors, venueLine } from "./format.js";
import { STATUS_GLYPH, theme } from "./theme.js";

export interface Segment {
  text: string;
  style?: Style;
}
export type Line = Segment[];

export const PREVIEW_TABS = ["Info", "Abstract", "Notes", "BibTeX"] as const;
export type PreviewTab = (typeof PREVIEW_TABS)[number];

export interface PaperPreview {
  lines: Line[];
  /** Info tab only: room below the text for the first-page thumbnail. */
  wantsImage: boolean;
}

// Wraps one line of code-like text, keeping its indentation on every continuation line.
function wrapIndented(line: string, width: number): string[] {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const text = line.trim().replace(/\s+/g, " ");
  const [head = "", ...more] = wrap(text, Math.max(4, width - indent.length));
  if (!more.length) { return [indent + head]; }
  // Continuation lines are indented two more cells, so only they are wrapped narrower.
  const pad = indent.length + 2 < width ? indent + "  " : "";
  const rest = text.slice(head.length).trim();
  return [indent + head, ...wrap(rest, Math.max(4, width - pad.length)).map((part) => pad + part)];
}

function para(text: string, width: number, style?: Style, maxLines = Infinity): Line[] {
  const lines = wrap(text, width);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines && kept.length) {
    kept[kept.length - 1] = kept[kept.length - 1]!.replace(/.?$/, "…");
  }
  return kept.map((t) => [{ text: t, ...(style ? { style } : {}) }]);
}

function field(label: string, value: string, width: number, valueStyle?: Style): Line[] {
  const pad = 7;
  const lines = wrap(value, Math.max(4, width - pad));
  return lines.map((text, i) => [
    { text: (i === 0 ? label : "").padEnd(pad), style: theme.label },
    { text, ...(valueStyle ? { style: valueStyle } : {}) },
  ]);
}

function textLayerLabel(record: PaperRecord): string | undefined {
  const layer = record.textLayer;
  if (!layer) { return undefined; }
  switch (layer.state) {
    case "native": return "searchable";
    case "ocr": return `searchable (OCR${layer.ocrPages ? `, ${layer.ocrPages} pages` : ""})`;
    case "missing": return "scanned, not searchable";
    case "failed": return `unreadable${layer.reason ? ` (${layer.reason})` : ""}`;
  }
}

/**
 * The Info tab: title, authors, venue, status and tags, identifiers, where it lives, PDF and reading state, note.
 * @returns the lines
 */
export function infoLines(entry: PaperEntry, data: PaperData | undefined, width: number): Line[] {
  const r = entry.record;
  const lines: Line[] = [];
  lines.push(...para(r.title, width, theme.title, 4));
  if (r.authors?.length) { lines.push(...para(r.authors.join(", "), width, theme.text, 3)); }
  const venue = venueLine(r);
  if (venue) { lines.push(...para(venue, width, theme.dim, 2)); }
  lines.push([]);

  lines.push([
    { text: "Status ".padEnd(7), style: theme.label },
    { text: `${STATUS_GLYPH[r.status]} ${r.status}`, style: theme.status[r.status] },
  ]);
  if (r.tags?.length) {
    const tagLine: Line = [{ text: "Tags".padEnd(7), style: theme.label }];
    r.tags.forEach((tag, i) => tagLine.push({ text: (i ? " " : "") + "#" + tag, style: theme.tag }));
    lines.push(tagLine);
  }
  lines.push(...field("Key", r.citeKey, width));
  if (r.doi) { lines.push(...field("DOI", r.doi, width, theme.link)); } else if (r.url) { lines.push(...field("URL", r.url, width, theme.link)); }
  lines.push(...field("In", entry.collection ? entry.collection.split("/").join(" › ") : "library root", width));
  lines.push(...field("PDF", r.hasPdf === false ? "not on this device" : entry.pdfBytes !== undefined ? formatBytes(entry.pdfBytes) : "yes", width,
    r.hasPdf === false ? theme.warn : undefined));
  const layer = textLayerLabel(r);
  if (layer) { lines.push(...field("Text", layer, width)); }
  if (data) {
    const highlights = data.annotations.length;
    if (highlights) { lines.push(...field("Notes", `${highlights} highlight${highlights === 1 ? "" : "s"} — Tab to read`, width)); }
    if (data.reading?.page) { lines.push(...field("Read", `stopped at page ${data.reading.page}`, width)); }
  }
  if (r.note?.trim()) {
    lines.push([]);
    lines.push([{ text: "Note", style: theme.label }]);
    lines.push(...para(r.note.trim(), width, theme.text, 6));
  }
  return lines;
}

function abstractLines(record: PaperRecord, width: number): Line[] {
  const lines: Line[] = [];
  if (record.summary?.trim()) {
    lines.push(...para(record.summary.trim(), width));
  } else {
    lines.push([{ text: "No abstract stored for this paper.", style: theme.dim }]);
  }
  if (record.keywords?.length) {
    lines.push([]);
    lines.push([{ text: "Keywords", style: theme.label }]);
    lines.push(...para(record.keywords.join(", "), width, theme.tag));
  }
  return lines;
}

function annotationLines(annotations: Annotation[], width: number): Line[] {
  if (!annotations.length) {
    return [
      [{ text: "No highlights or notes yet.", style: theme.dim }],
      [],
      ...para("Highlights made in the VS Code or browser reader appear here.", width, theme.dim),
    ];
  }
  const lines: Line[] = [];
  let page = -1;
  for (const annotation of annotations) {
    if (annotation.pageNumber !== page) {
      page = annotation.pageNumber;
      if (lines.length) { lines.push([]); }
      lines.push([{ text: `p. ${page}`, style: theme.label }]);
    }
    const bar = theme.annotation[annotation.color ?? "yellow"] ?? theme.annotation["yellow"]!;
    // Text-layer selections carry the PDF's line breaks; the reader's own cleanup makes them read as prose.
    const text = (annotation.type === "highlight" ? cleanQuote(annotation.content) : annotation.content.trim()) || "(empty)";
    for (const row of wrap(text, Math.max(4, width - 2))) {
      lines.push([{ text: "▌ ", style: bar }, { text: row, ...(annotation.type === "highlight" ? {} : { style: theme.bold }) }]);
    }
  }
  return lines;
}

/**
 * Lines of one preview tab of a paper.
 * @returns the lines and whether a thumbnail fits under them
 */
export function paperPreview(entry: PaperEntry, data: PaperData | undefined, tab: PreviewTab, width: number, bibtex: string): PaperPreview {
  switch (tab) {
    case "Info": return { lines: infoLines(entry, data, width), wantsImage: entry.record.hasPdf !== false };
    case "Abstract": return { lines: abstractLines(entry.record, width), wantsImage: false };
    case "Notes": return { lines: annotationLines(data?.annotations ?? [], width), wantsImage: false };
    case "BibTeX": return { lines: bibtex.split("\n").flatMap((l) => wrapIndented(l, width).map((t) => [{ text: t }])), wantsImage: false };
  }
}

/**
 * The tab bar of the paper preview.
 * @returns one line
 */
export function tabBar(active: PreviewTab, annotationCount: number): Line {
  const line: Line = [];
  for (const tab of PREVIEW_TABS) {
    const label = tab === "Notes" && annotationCount ? `Notes ${annotationCount}` : tab;
    line.push({ text: ` ${label} `, style: tab === active ? theme.tabActive : theme.tabInactive });
  }
  return line;
}

/**
 * Preview of a hovered folder: how many papers it holds by status, its subfolders, and its papers.
 * @returns the lines
 */
export function folderPreview(
  node: CollectionNode,
  snapshot: LibrarySnapshot,
  papers: PaperEntry[],
  label = node.name,
  options: { directOnly?: boolean } = {},
): Line[] {
  const lines: Line[] = [[{ text: label, style: theme.title }]];
  // "Unfiled" is the library root seen as a folder: only the papers directly in it, no subfolders.
  const children = options.directOnly ? [] : node.children;
  const total = options.directOnly ? papers.length : node.total;
  const subs = children.length;
  lines.push([
    { text: `${total} paper${total === 1 ? "" : "s"}`, style: theme.dim },
    { text: subs ? ` · ${subs} subfolder${subs === 1 ? "" : "s"}` : "", style: theme.dim },
  ]);
  const counts = { unread: 0, reading: 0, done: 0 };
  const scope = options.directOnly ? papers : [...snapshot.papers.values()].filter((entry) =>
    !node.rel || entry.collection === node.rel || entry.collection.startsWith(node.rel + "/"));
  for (const entry of scope) { counts[entry.record.status]++; }
  if (total) {
    lines.push([
      { text: `${STATUS_GLYPH.reading} ${counts.reading} reading  `, style: theme.status.reading },
      { text: `${STATUS_GLYPH.unread} ${counts.unread} unread  `, style: theme.status.unread },
      { text: `${STATUS_GLYPH.done} ${counts.done} done`, style: theme.status.done },
    ]);
  }
  lines.push([]);
  for (const childRel of children) {
    const child = snapshot.collections.get(childRel);
    if (child) { lines.push([{ text: child.name + "/", style: theme.collection }, { text: ` ${child.total}`, style: theme.count }]); }
  }
  if (children.length && papers.length) { lines.push([]); }
  for (const paper of papers) {
    const r = paper.record;
    lines.push([
      { text: STATUS_GLYPH[r.status] + " ", style: theme.status[r.status] },
      { text: r.title, ...(r.hasPdf === false ? { style: theme.noPdf } : {}) },
    ]);
  }
  if (!children.length && !papers.length) { lines.push([{ text: "Empty folder", style: theme.dim }]); }
  return lines;
}

/**
 * Library-wide numbers for the parent pane at the root.
 * @returns the lines
 */
export function libraryOverview(snapshot: LibrarySnapshot): Line[] {
  const counts = { unread: 0, reading: 0, done: 0 };
  let withPdf = 0;
  for (const { record } of snapshot.papers.values()) {
    counts[record.status]++;
    if (record.hasPdf !== false) { withPdf++; }
  }
  const lines: Line[] = [
    [{ text: "Library", style: theme.bold }],
    [{ text: `${snapshot.papers.size} papers`, style: theme.dim }],
    [],
    [{ text: `${STATUS_GLYPH.reading} ${counts.reading} reading`, style: theme.status.reading }],
    [{ text: `${STATUS_GLYPH.unread} ${counts.unread} unread`, style: theme.status.unread }],
    [{ text: `${STATUS_GLYPH.done} ${counts.done} done`, style: theme.status.done }],
    [],
    [{ text: `${withPdf} with PDF`, style: theme.dim }],
  ];
  return lines;
}

/** Short one-line description of a paper for pickers and messages. */
export function paperLabel(record: PaperRecord): string {
  const authors = shortAuthors(record.authors, 1);
  return [record.title, authors, record.year].filter(Boolean).join(" · ");
}
