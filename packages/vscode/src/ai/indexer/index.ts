/**
 * Barrel re-export for AI indexer.
 *
 * @depends indexerQueue.ts, aiIndexer.ts
 * @dependents service/aiServiceFactory, extension.ts
 */
export { IndexerQueue } from "./indexerQueue.js";
export type { IndexerJob } from "./indexerQueue.js";
export { AiIndexer } from "./aiIndexer.js";
export type { AiIndexerDependencies } from "./aiIndexer.js";
