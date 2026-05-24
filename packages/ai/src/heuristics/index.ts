/**
 * Barrel re-export for heuristic NLP utilities. None of these require an LLM.
 *
 * @depends methodDetector.ts, datasetExtractor.ts, codeRepoExtractor.ts, reproScorer.ts, computeExtractor.ts, limitationsExtractor.ts, citationExtractor.ts, claimDetector.ts, difficultyScorer.ts, termNovelty.ts, titleDedup.ts
 * @dependents pipeline/ingestionStages.ts, vscode features
 */
export { detectMethods } from "./methodDetector.js";
export { detectDatasets } from "./datasetExtractor.js";
export { extractCodeRepos } from "./codeRepoExtractor.js";
export { scoreReproducibility } from "./reproScorer.js";
export { extractCompute } from "./computeExtractor.js";
export { extractLimitations } from "./limitationsExtractor.js";
export { extractCitations } from "./citationExtractor.js";
export type { CitationMark } from "./citationExtractor.js";
export { detectClaims } from "./claimDetector.js";
export type { ClaimCandidate } from "./claimDetector.js";
export { scorePageDifficulty, scoreDifficultyProfile } from "./difficultyScorer.js";
export { extractTerms, countNovelTerms } from "./termNovelty.js";
export { normalizeTitle, titleSimilarity } from "./titleDedup.js";
