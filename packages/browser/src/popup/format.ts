/**
 * Pure text helpers for the popup: the one-line byline under the title, tag
 * parsing, and human labels for folders.
 * @depends platform/runtimeMessages (types)
 * @dependents popup/index
 */
import type { DraftView, FoldersData } from "../platform/runtimeMessages";

/** "Edelman, Arias, Smith · SIAM J. Matrix Anal. Appl. · 1998" — surnames, et al. past three. */
export function metaLine(d: Pick<DraftView, "authors" | "venue" | "year">): string {
  const surnames = d.authors.map((a) => a.trim().split(/\s+/).pop() ?? a).filter(Boolean);
  const who = surnames.length > 3 ? `${surnames[0]} et al.` : surnames.join(", ");
  return [who, d.venue, d.year].filter(Boolean).join(" · ");
}

/** "ml, Thesis ch2 , ml" → ["ml", "Thesis ch2"]: trimmed, de-duplicated case-insensitively. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;]/)) {
    const tag = raw.replace(/\s+/g, " ").trim().replace(/^#/, "");
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

/** "papers/Thesis/Chapter 2" → "Thesis / Chapter 2"; the root is "Library". */
export function folderPathLabel(path: string): string {
  const rel = path.replace(/^papers\/?/, "");
  return rel ? rel.split("/").join(" / ") : "Library";
}

/** The folder's display name: its path inside the library, "Library" for the root. */
export function folderName(path: string, folders: FoldersData): string {
  const known = folders.folders.find((f) => f.path === path);
  return known?.depth === 0 ? known.label : folderPathLabel(path);
}
