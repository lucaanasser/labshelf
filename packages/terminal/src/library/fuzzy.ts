/**
 * fzf-style subsequence matching for the jump pickers (z: collections, Z: papers). Consecutive characters, word starts
 * and early matches score higher, so "atn" finds "Attention Is All You Need" before "Data anonymisation".
 *
 * @depends tui/text (fold)
 * @dependents ui/app (pickers)
 */
import { fold } from "../tui/text.js";

/**
 * @usedBy rankFuzzy
 * @returns the score (higher is better) and matched positions, or undefined when the pattern is not a subsequence
 */
export function fuzzyScore(pattern: string, text: string): { score: number; positions: number[] } | undefined {
  const p = fold(pattern).replace(/\s+/g, "");
  if (!p) { return { score: 0, positions: [] }; }
  const t = fold(text);
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of p) {
    const found = t.indexOf(ch, ti);
    if (found < 0) { return undefined; }
    const atWordStart = found === 0 || /[\s\-_/.:,(]/.test(t[found - 1] ?? "");
    streak = found === ti && positions.length > 0 ? streak + 1 : 0;
    score += 1 + streak * 3 + (atWordStart ? 4 : 0) - Math.min(found - ti, 10) * 0.2;
    positions.push(found);
    ti = found + 1;
  }
  // Prefer shorter haystacks and earlier first matches.
  score -= (positions[0] ?? 0) * 0.05 + t.length * 0.01;
  return { score, positions };
}

/**
 * Filters and ranks items by fuzzy match against their label.
 * @usedBy ui/app (pickers)
 * @returns matching items, best first (input order kept for an empty pattern)
 */
export function rankFuzzy<T>(items: readonly T[], pattern: string, label: (item: T) => string): T[] {
  if (!pattern.trim()) { return [...items]; }
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const match = fuzzyScore(pattern, label(item));
    if (match) { scored.push({ item, score: match.score, index }); }
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}
