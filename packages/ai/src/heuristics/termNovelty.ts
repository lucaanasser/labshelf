/**
 * Tracks term novelty against an accumulated user vocabulary. Feeds the
 * difficulty score (F02) and powers the "you keep tripping on X" suggestion
 * surfaces. Stopwords are filtered so common English words never count as
 * novel.
 *
 * @depends none
 * @dependents heuristics/difficultyScorer.ts
 */

const STOPWORDS = new Set([
  "the", "and", "of", "to", "a", "in", "is", "that", "for", "on", "with",
  "as", "by", "this", "we", "are", "be", "or", "an", "from", "at", "it",
  "our", "their", "its", "which", "these", "those", "have", "has", "was",
  "were", "can", "may", "also", "more", "than", "such", "but", "not", "no",
]);

const TOKEN = /[A-Za-z][A-Za-z'-]{2,}/g;

/**
 * Returns the lowercased terms appearing in the text minus stopwords.
 *
 * @usedBy difficultyScorer
 * @returns Set of normalized terms.
 */
export function extractTerms(text: string): Set<string> {
  const tokens = text.match(TOKEN) ?? [];
  const out = new Set<string>();
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (!STOPWORDS.has(lower)) out.add(lower);
  }
  return out;
}

/**
 * Counts how many of the terms in `text` are not present in `knownVocab`.
 *
 * @usedBy difficultyScorer
 * @returns Count of novel terms (no upper bound).
 */
export function countNovelTerms(text: string, knownVocab: Set<string>): number {
  const terms = extractTerms(text);
  let n = 0;
  for (const t of terms) if (!knownVocab.has(t)) n += 1;
  return n;
}
