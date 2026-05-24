/**
 * F24 — Claim detection (heuristic pre-filter). Identifies sentences that
 * express strong assertions and lack a nearby citation marker. The Copilot
 * tier later refines these candidates with an LLM; for the local tier this is
 * usable on its own to surface "[citation needed]" diagnostics.
 *
 * @depends ./citationExtractor.ts
 * @dependents vscode citation-needed provider (phase 1.E)
 */
import { extractCitations } from "./citationExtractor.js";

const STRONG_OPENERS = [
  /\bit is well[-\s]?known\b/i,
  /\bprior work has shown\b/i,
  /\b(?:we|it) (?:proves?|demonstrates?|shows?)\b/i,
  /\b(?:research|studies) (?:have|has) shown\b/i,
  /\boutperforms?\s+(?:all|the)\b/i,
  /\bachieves? state-of-the-art\b/i,
];

export interface ClaimCandidate {
  sentence: string;
  offset: number;
  hasNearbyCitation: boolean;
}

const NEAR_CITATION_WINDOW = 80;

/**
 * Finds candidate claims in the text. Sentences containing a strong assertion
 * pattern qualify; those without a citation within `NEAR_CITATION_WINDOW`
 * characters are flagged for diagnostics.
 *
 * @usedBy vscode ParaphraseGuardProvider, CitationNeededProvider
 * @returns Candidate claims, each tagged with whether a citation is nearby.
 */
export function detectClaims(text: string): ClaimCandidate[] {
  if (!text) return [];
  const citations = extractCitations(text);
  const sentences = splitSentencesWithOffsets(text);
  const out: ClaimCandidate[] = [];
  for (const item of sentences) {
    if (!STRONG_OPENERS.some((re) => re.test(item.sentence))) continue;
    const hasNearby = citations.some(
      (c) =>
        c.offset >= item.offset - NEAR_CITATION_WINDOW &&
        c.offset <= item.offset + item.sentence.length + NEAR_CITATION_WINDOW,
    );
    out.push({
      sentence: item.sentence.trim(),
      offset: item.offset,
      hasNearbyCitation: hasNearby,
    });
  }
  return out;
}

function splitSentencesWithOffsets(
  text: string,
): { sentence: string; offset: number }[] {
  const out: { sentence: string; offset: number }[] = [];
  let cursor = 0;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    out.push({ sentence, offset: cursor });
    cursor += sentence.length + 1;
  }
  return out;
}
