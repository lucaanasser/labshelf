/**
 * Public surface of @labshelf/ai — pure, platform-agnostic primitives for AI
 * features. Runtimes (ONNX, vscode.lm), persistence (sqlite-vec), and UI live
 * in consumer packages. This package contains contracts, chunking, heuristic
 * NLP, RAG primitives, ingestion pipeline orchestration, cross-paper analysis,
 * and external clients (Semantic Scholar).
 *
 * @depends types, chunking, heuristics, rag, pipeline, analysis, external
 * @dependents @labshelf/vscode (src/ai), @labshelf/browser (future)
 */
export * from "./types/index.js";
export * from "./chunking/index.js";
export * from "./heuristics/index.js";
export * from "./rag/index.js";
export * from "./pipeline/index.js";
export * from "./analysis/index.js";
export * from "./external/index.js";
