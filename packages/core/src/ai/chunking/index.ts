/**
 * Barrel re-export for chunking utilities.
 */
export { detectSections } from "./sectionDetector.js";
export { chunkBySection } from "./sectionChunker.js";
export type { SectionChunkerOptions } from "./sectionChunker.js";
export { estimateTokens, charsForTokenBudget } from "./tokenEstimator.js";
