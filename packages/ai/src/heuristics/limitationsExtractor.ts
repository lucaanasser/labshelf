/**
 * F15 — Heuristic fallback for limitations extraction. Looks for a section
 * titled "Limitations" / "Threats to Validity" and returns its bullet/lines.
 * When no dedicated section exists, scans for sentences starting with common
 * hedge phrases ("we acknowledge", "a limitation of"). The LLM-driven version
 * lives in the Copilot tier (Phase 2) and supersedes this when available.
 *
 * @depends none
 * @dependents pipeline/ingestionStages.ts
 */

const SECTION_RE = /\b(?:Limitations?|Threats to Validity)\b/i;
const HEDGES = [
  /\bwe acknowledge\b/i,
  /\ba limitation of\b/i,
  /\bone limitation\b/i,
  /\bwe do not (?:compare|evaluate)\b/i,
  /\bfuture work\b/i,
];

/**
 * Extracts limitation bullets from the paper's text.
 *
 * @usedBy ingestionStages
 * @returns Up to ten concise limitation snippets.
 */
export function extractLimitations(text: string): string[] {
  if (!text) return [];
  const fromSection = sliceSection(text);
  if (fromSection.length > 0) return fromSection.slice(0, 10);
  return scanHedges(text).slice(0, 10);
}

function sliceSection(text: string): string[] {
  const match = SECTION_RE.exec(text);
  if (!match) return [];
  const startIdx = match.index;
  const window = text.slice(startIdx, startIdx + 4000);
  const lines = window
    .split(/\n+/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 20 && l.length < 400);
  return lines.slice(0, 15);
}

function scanHedges(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => HEDGES.some((re) => re.test(s))).map((s) => s.trim());
}
