/**
 * Small formatting helpers shared by the TUI and the CLI output.
 *
 * @depends @labshelf/core (types)
 * @dependents ui/*, cli/*
 */
import type { PaperRecord } from "@labshelf/core";

/**
 * "just now", "5 min ago", "3 h ago", "2 d ago", or a date.
 * @usedBy ui/render (sync status), cli sync
 * @returns the relative time
 */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) { return "never"; }
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) { return "never"; }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) { return "just now"; }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) { return `${minutes} min ago`; }
  const hours = Math.round(minutes / 60);
  if (hours < 24) { return `${hours} h ago`; }
  const days = Math.round(hours / 24);
  if (days < 30) { return `${days} d ago`; }
  return new Date(then).toISOString().slice(0, 10);
}

/**
 * Bytes as "812 KB" / "2.4 MB".
 * @usedBy ui/preview, cli show
 * @returns the size text
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) { return `${kb} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "Vaswani, Shazeer, Parmar et al." — the first `max` authors.
 * @usedBy ui/preview, cli ls
 * @returns the short author list
 */
export function shortAuthors(authors: string[] | undefined, max = 3): string {
  if (!authors?.length) { return ""; }
  const names = authors.map((a) => (a.includes(",") ? a.split(",")[0]!.trim() : a.trim().split(/\s+/).pop() ?? a));
  return names.length > max ? `${names.slice(0, max).join(", ")} et al.` : names.join(", ");
}

/**
 * "Nature · 2017 · 12(3) · pp. 45–67"
 * @usedBy ui/preview, cli show
 * @returns the venue line, or "" when nothing is known
 */
export function venueLine(record: PaperRecord): string {
  const parts: string[] = [];
  const venue = record.journal || record.publisher;
  if (venue) { parts.push(venue); }
  if (record.year) { parts.push(String(record.year)); }
  if (record.volume) { parts.push(record.issue ? `${record.volume}(${record.issue})` : record.volume); }
  if (record.pages) { parts.push(`pp. ${record.pages}`); }
  return parts.join(" · ");
}

/**
 * The link most useful to open or copy for a paper.
 * @usedBy ui/app (y d), cli show
 * @returns https://doi.org/… or the stored URL
 */
export function paperLink(record: PaperRecord): string | undefined {
  if (record.doi) { return `https://doi.org/${record.doi}`; }
  return record.url;
}

/**
 * Collection path for display: "papers › ML › Transformers".
 * @usedBy ui/render
 * @returns the breadcrumb parts
 */
export function crumbs(rel: string): string[] {
  return ["papers", ...rel.split("/").filter(Boolean)];
}
