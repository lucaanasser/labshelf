/**
 * F02 — Reading difficulty heatmap scorer. Combines three signals:
 *
 *   1. Flesch-Kincaid grade-level (sentence and word complexity).
 *   2. Equation density (LaTeX-style markers per paragraph).
 *   3. Novel terms (callers may pass a known-vocabulary set).
 *
 * The output is a 0..1 difficulty score per page.
 *
 * @depends ./termNovelty.ts
 * @dependents pipeline/ingestionStages.ts, vscode difficulty heatmap
 */
import { countNovelTerms } from "./termNovelty.js";

const EQUATION_TOKEN = /(\$[^$]+\$|\\\(|\\\[|\\begin\{equation\}|\\sum|\\int|\\frac|\\sqrt|=\s*\\?[A-Za-z])/g;
const WORD = /[A-Za-z][A-Za-z'-]*/g;
const SENTENCE = /[.!?]+\s/g;
const VOWEL_GROUP = /[aeiouy]+/g;

/**
 * Scores a single page of text on the 0..1 difficulty axis.
 *
 * @usedBy ingestionStages, difficulty heatmap
 * @returns Difficulty score where 0 is easy and 1 is dense/expert.
 */
export function scorePageDifficulty(text: string, knownVocab?: Set<string>): number {
  if (!text || text.trim().length === 0) return 0;
  const grade = fleschKincaidGrade(text);
  const eqDensity = equationDensity(text);
  const novelty = knownVocab ? countNovelTerms(text, knownVocab) / 100 : 0;
  const gradeNorm = clamp(grade / 20, 0, 1);
  const eqNorm = clamp(eqDensity * 5, 0, 1);
  const noveltyNorm = clamp(novelty, 0, 1);
  const composite = 0.5 * gradeNorm + 0.3 * eqNorm + 0.2 * noveltyNorm;
  return Number(composite.toFixed(3));
}

/**
 * Convenience entry point — scores every page in one pass.
 *
 * @usedBy ingestionStages
 * @returns Map of page number to difficulty score.
 */
export function scoreDifficultyProfile(
  pages: { page: number; text: string }[],
  knownVocab?: Set<string>,
): Record<number, number> {
  const profile: Record<number, number> = {};
  for (const p of pages) profile[p.page] = scorePageDifficulty(p.text, knownVocab);
  return profile;
}

function fleschKincaidGrade(text: string): number {
  const sentences = Math.max(1, (text.match(SENTENCE) ?? []).length);
  const words = text.match(WORD) ?? [];
  if (words.length === 0) return 0;
  const syllables = words.reduce((acc, w) => acc + Math.max(1, countSyllables(w)), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

function countSyllables(word: string): number {
  const groups = word.toLowerCase().match(VOWEL_GROUP);
  return groups ? groups.length : 1;
}

function equationDensity(text: string): number {
  const tokens = text.match(EQUATION_TOKEN);
  if (!tokens) return 0;
  return tokens.length / Math.max(1, text.length / 1000);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
