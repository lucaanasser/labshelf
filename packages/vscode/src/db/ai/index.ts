/**
 * Barrel re-export for AI-side persistence (schema + stores).
 *
 * @depends aiSchema.ts, embeddingCodec.ts, sqliteVectorStore.ts, aiMetadataStore.ts, readingEventsStore.ts, s2CacheStore.ts
 * @dependents ai/aiIndexer, ai/aiService, extension.ts wiring
 */
export { ensureAiSchema } from "./aiSchema.js";
export { encodeEmbedding, decodeEmbedding } from "./embeddingCodec.js";
export { SqliteVectorStore } from "./sqliteVectorStore.js";
export { AiMetadataStore } from "./aiMetadataStore.js";
export { ReadingEventsStore } from "./readingEventsStore.js";
export { S2CacheStore } from "./s2CacheStore.js";
export type { S2CacheEntry } from "./s2CacheStore.js";
