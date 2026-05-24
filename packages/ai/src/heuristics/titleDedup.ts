/**
 * F21 — Preprint to conference deduplication. Two papers are likely the same
 * work when their normalized titles share a high Jaccard score over token
 * shingles. Embedding-based deduplication adds a second pass downstream; this
 * heuristic provides the fast initial filter.
 *
 * @depends none
 * @dependents analysis/titleDedupAggregator (consumer-side)
 */

/**
 * Normalises a paper title for comparison: lowercase, drop punctuation,
 * collapse whitespace, strip common subtitle markers.
 *
 * @usedBy titleSimilarity, analysis aggregators
 * @returns Canonicalised title string.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes Jaccard similarity between two normalised titles over word shingles.
 *
 * @usedBy preprint-merge UI
 * @returns Value in [0,1] where 1 means identical token sets.
 */
export function titleSimilarity(a: string, b: string): number {
  const sa = shingles(normalizeTitle(a));
  const sb = shingles(normalizeTitle(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersect = 0;
  for (const s of sa) if (sb.has(s)) intersect += 1;
  const union = sa.size + sb.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function shingles(text: string): Set<string> {
  const tokens = text.split(" ").filter((t) => t.length > 1);
  if (tokens.length < 2) return new Set(tokens);
  const out = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) out.add(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}
