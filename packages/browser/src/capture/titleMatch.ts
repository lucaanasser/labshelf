/**
 * Decides whether two bibliographic records describe the same work. Aggregators
 * and title searches routinely return a neighbouring paper (the research reports
 * caught BWA vs BWA-SW, ResNet vs an unrelated thesis, and XGBoost mapped to a
 * cognitive-impairment paper), so any candidate that did not come straight from
 * the DOI's own record must clear this guard before it is downloaded.
 *
 * The rule, from the apis research (§1.6, §4.2): normalised titles are equal, or
 * their word-bigram Dice coefficient is at least 0.9; publication years agree
 * within a tolerance (wider for preprints, whose online-first date drifts from
 * the version of record); and, when both sides list authors, they share at least
 * one surname. Pure and network-free so every rule can be unit-tested.
 * @depends capture/libraryMatch (normalizeTitle), capture/metadataResolver (surname)
 * @dependents capture/resolvers/{openalexResolver,semanticScholarResolver,europePmcResolver,arxivTitleResolver,repositoryResolver}
 */
import { normalizeTitle } from "./libraryMatch";
import { surname } from "./metadataResolver";

/** A record thin enough for the comparison: whatever a source managed to supply. */
export interface WorkRef {
  title?: string | undefined;
  year?: number | undefined;
  authors?: string[] | undefined;
}

export interface SameWorkOptions {
  /** Allowed absolute difference in publication year. Default 1; callers pass 2 for preprint vs version-of-record. */
  yearSlack?: number;
}

// Below this, two titles are treated as different works. 0.9 keeps genuine
// variants together (U-Net vs "U Net …") while splitting near-neighbours such
// as BWA (short-read) vs BWA-SW (long-read), which scores ~0.78 on word bigrams.
const TITLE_DICE_MIN = 0.9;

/**
 * True when `a` and `b` plausibly describe the same paper.
 * @usedBy the open-access resolvers, to reject wrong-item candidates
 */
export function sameWork(a: WorkRef, b: WorkRef, opts: SameWorkOptions = {}): boolean {
  const ta = a.title ? normalizeTitle(a.title) : "";
  const tb = b.title ? normalizeTitle(b.title) : "";
  // Without a title on both sides there is nothing to anchor the identity to.
  if (!ta || !tb) return false;
  if (ta !== tb && wordBigramDice(ta, tb) < TITLE_DICE_MIN) return false;

  const yearSlack = opts.yearSlack ?? 1;
  if (a.year !== undefined && b.year !== undefined && Math.abs(a.year - b.year) > yearSlack) {
    return false;
  }

  if (a.authors?.length && b.authors?.length) {
    const surnamesA = new Set(a.authors.map(surname).filter(Boolean));
    const shared = b.authors.map(surname).some((s) => s !== "" && surnamesA.has(s));
    if (!shared) return false;
  }

  return true;
}

/**
 * Dice coefficient over the multiset of adjacent word pairs of two normalised
 * titles. Word bigrams (not characters, not single words) are what separates
 * near-neighbours: on single words BWA vs BWA-SW scores 0.9 and would be
 * accepted, while on word bigrams it scores ~0.78 and is rejected.
 * @usedBy sameWork
 */
export function wordBigramDice(normA: string, normB: string): number {
  const a = wordBigrams(normA);
  const b = wordBigrams(normB);
  if (a.length === 0 || b.length === 0) return normA === normB ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of a) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of b) {
    const left = counts.get(g) ?? 0;
    if (left > 0) {
      overlap += 1;
      counts.set(g, left - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

// Adjacent word pairs; a one-word title falls back to that single word so short
// titles still compare instead of scoring 0.
function wordBigrams(norm: string): string[] {
  const words = norm.split(" ").filter((w) => w.length > 0);
  if (words.length < 2) return words;
  const grams: string[] = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    const left = words[i];
    const right = words[i + 1];
    if (left !== undefined && right !== undefined) grams.push(`${left} ${right}`);
  }
  return grams;
}
