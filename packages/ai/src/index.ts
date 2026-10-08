/**
 * Public surface of @labshelf/ai: platform-agnostic primitives for AI features.
 * Embedding providers, persistence (SQLite) and UI live in consumer packages.
 */
export * from "./types/index.js";
export * from "./chunking/index.js";
export * from "./heuristics/index.js";
export * from "./rag/index.js";
export * from "./pipeline/index.js";
