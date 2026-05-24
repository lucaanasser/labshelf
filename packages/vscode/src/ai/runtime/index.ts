/**
 * Barrel re-export for AI runtime adapters and model management.
 *
 * @depends modelManifest.ts, modelPaths.ts, modelDownloader.ts, hashEmbeddingProvider.ts, onnxEmbeddingProvider.ts
 * @dependents service/aiServiceFactory, indexer/aiIndexer
 */
export {
  MODELS,
  TEXT_EMBEDDING_DEFAULT_ID,
  VISION_EMBEDDING_DEFAULT_ID,
  findModel,
} from "./modelManifest.js";
export type { ModelDescriptor, ModelKind } from "./modelManifest.js";
export { resolveModelPaths } from "./modelPaths.js";
export type { ModelPaths } from "./modelPaths.js";
export { ModelDownloader } from "./modelDownloader.js";
export type { ModelDownloaderDependencies } from "./modelDownloader.js";
export { HashEmbeddingProvider } from "./hashEmbeddingProvider.js";
export { OnnxEmbeddingProvider } from "./onnxEmbeddingProvider.js";
