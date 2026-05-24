/**
 * F03 — Citation marker extraction. Parses inline citation marks like [12],
 * [12, 13], or (Vaswani et al., 2017) and emits structured records that the
 * citation popup resolver consumes to locate the referenced paper.
 *
 * @depends none
 * @dependents pipeline/ingestionStages.ts, vscode citation popup feature
 */

export interface CitationMark {
  kind: "numeric" | "authorYear";
  raw: string;
  offset: number;
  numbers?: number[];
  authors?: string;
  year?: number;
}

const NUMERIC = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;
const AUTHOR_YEAR =
  /\(([A-Z][A-Za-z'’-]+(?:(?:\s+et al\.?)|(?:\s+(?:&|and)\s+[A-Z][A-Za-z'’-]+))?),?\s*(\d{4})[a-z]?\)/g;

/**
 * Returns inline citation marks discovered in the source text.
 *
 * @usedBy ingestionStages, citation popups
 * @returns Marks tagged with offset and parsed contents.
 */
export function extractCitations(text: string): CitationMark[] {
  const out: CitationMark[] = [];
  for (const m of text.matchAll(NUMERIC)) {
    if (m.index === undefined || !m[1]) continue;
    const nums = m[1]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    out.push({
      kind: "numeric",
      raw: m[0],
      offset: m.index,
      numbers: nums,
    });
  }
  for (const m of text.matchAll(AUTHOR_YEAR)) {
    if (m.index === undefined || !m[1] || !m[2]) continue;
    out.push({
      kind: "authorYear",
      raw: m[0],
      offset: m.index,
      authors: m[1],
      year: parseInt(m[2], 10),
    });
  }
  out.sort((a, b) => a.offset - b.offset);
  return out;
}
