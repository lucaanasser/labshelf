/**
 * Public surface of the AI primitives: platform-agnostic types, chunking, heuristics, RAG and the ingestion pipeline.
 * Embedding providers, persistence (SQLite) and UI live in consumer packages.
 */
export * from "./types/index.js";
export * from "./chunking/index.js";
export * from "./heuristics/index.js";
export * from "./rag/index.js";
export * from "./pipeline/index.js";
