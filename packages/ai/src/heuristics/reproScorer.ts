/**
 * F14 — Reproducibility score. Checks for the presence of well-known
 * reproducibility signals in the paper's text. Returns a 0..10 score where
 * each signal is worth two points.
 *
 * @depends ../types/metadata.ts
 * @dependents pipeline/ingestionStages.ts
 */
import type { ReproducibilityScore } from "../types/metadata.js";

const SIGNALS = {
  hasCode: [/code (?:is )?(?:released|available|public)/i, /github\.com\//i],
  hasData: [/dataset (?:is )?(?:released|public|available)/i, /data (?:is )?available at/i],
  hasHyperparams: [/hyper-?parameter/i, /learning rate/i, /batch size/i, /optimizer/i],
  hasSeeds: [/random seed/i, /\bseed\s*[=:]/i, /three seeds/i, /multiple seeds/i],
  hasHardwareDetails: [/\b\d+\s*(?:GPU|TPU)s?\b/i, /\bA100\b/, /\bH100\b/, /\bV100\b/, /\bTPU\s?v\d/i],
};

/**
 * Computes a reproducibility score over the paper's text.
 *
 * @usedBy ingestionStages, list panel badges
 * @returns Score plus the booleans that contributed to it.
 */
export function scoreReproducibility(text: string): ReproducibilityScore {
  const hasCode = anyMatch(text, SIGNALS.hasCode);
  const hasData = anyMatch(text, SIGNALS.hasData);
  const hasHyperparams = anyMatch(text, SIGNALS.hasHyperparams);
  const hasSeeds = anyMatch(text, SIGNALS.hasSeeds);
  const hasHardwareDetails = anyMatch(text, SIGNALS.hasHardwareDetails);
  const score =
    (hasCode ? 2 : 0) +
    (hasData ? 2 : 0) +
    (hasHyperparams ? 2 : 0) +
    (hasSeeds ? 2 : 0) +
    (hasHardwareDetails ? 2 : 0);
  return {
    score,
    hasCode,
    hasData,
    hasHyperparams,
    hasSeeds,
    hasHardwareDetails,
  };
}

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}
