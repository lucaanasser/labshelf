/**
 * Barrel re-export for RAG primitives.
 *
 * @depends cosine.ts, retrieve.ts, stanceDetector.ts, rerank.ts
 * @dependents vscode aiService, downstream features
 */
export { cosine } from "./cosine.js";
export { retrieveTopK } from "./retrieve.js";
export type { RetrieveOptions } from "./retrieve.js";
export { searchByClaim } from "./stanceDetector.js";
export type { StanceDetectorOptions } from "./stanceDetector.js";
export { mmrRerank } from "./rerank.js";
export type { MmrOptions } from "./rerank.js";
