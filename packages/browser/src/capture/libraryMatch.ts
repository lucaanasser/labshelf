/**
 * Recognises a paper that is already in the library, so the popup and the
 * Scholar buttons can say "In LabShelf" instead of saving a duplicate. A DOI
 * or arXiv id settles it; otherwise the normalised title must match exactly
 * and the years must not disagree.
 * @depends @labshelf/core PaperRecord
 * @dependents capture/captureService, background/index
 */
import type { PaperRecord } from "@labshelf/core";

export interface PaperQuery {
  doi?: string | undefined;
  arxivId?: string | undefined;
  title?: string | undefined;
  year?: number | undefined;
}

// Shorter titles ("Introduction", "Editorial") are too common to identify a paper.
const MIN_TITLE_CHARS = 20;

/** Lower-cased, accent-folded, punctuation-free title for comparison. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The library record describing the queried paper, if any.
 * @usedBy capture/captureService, background/index (library.lookup)
 */
export function findInLibrary(records: PaperRecord[], query: PaperQuery): PaperRecord | undefined {
  const doi = query.doi?.toLowerCase();
  if (doi) {
    const hit = records.find((r) => r.doi?.toLowerCase() === doi);
    if (hit) return hit;
  }
  const arxiv = query.arxivId?.toLowerCase().replace(/v\d+$/, "");
  if (arxiv) {
    const hit = records.find((r) =>
      r.doi?.toLowerCase() === `10.48550/arxiv.${arxiv}` || (r.url ?? "").toLowerCase().includes(`arxiv.org/abs/${arxiv}`));
    if (hit) return hit;
  }
  const title = query.title ? normalizeTitle(query.title) : "";
  if (title.length < MIN_TITLE_CHARS) return undefined;
  return records.find((r) =>
    normalizeTitle(r.title) === title && !(query.year && r.year && Math.abs(query.year - r.year) > 1));
}
