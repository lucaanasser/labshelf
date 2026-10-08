/**
 * Barrel re-export for chunking utilities.
 *
 * @depends sectionDetector.ts, sectionChunker.ts, tokenEstimator.ts
 * @dependents pipeline/ingestionStages, vscode ai consumers
 */
export { detectSections } from "./sectionDetector.js";
export { chunkBySection } from "./sectionChunker.js";
export type { SectionChunkerOptions } from "./sectionChunker.js";
export { estimateTokens, charsForTokenBudget } from "./tokenEstimator.js";
