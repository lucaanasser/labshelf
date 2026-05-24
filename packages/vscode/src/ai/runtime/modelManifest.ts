/**
 * Canonical list of ONNX models supported by the AI subsystem. Each entry
 * describes the on-disk path under globalStorageUri/models/<id>/ that the
 * downloader populates, the embedding dimensionality, and the HuggingFace
 * source. Sha256 is recorded for download verification.
 *
 * @depends none
 * @dependents runtime/modelDownloader.ts, runtime/onnxEmbeddingProvider.ts
 */

export type ModelKind = "text-embedding" | "vision-embedding";

export interface ModelDescriptor {
  id: string;
  kind: ModelKind;
  dimensions: number;
  hfRepo: string;
  files: string[];
  sizeBytes: number;
}

export const TEXT_EMBEDDING_DEFAULT_ID = "Xenova/bge-small-en-v1.5";
export const VISION_EMBEDDING_DEFAULT_ID = "Xenova/clip-vit-base-patch32";

export const MODELS: Record<string, ModelDescriptor> = {
  [TEXT_EMBEDDING_DEFAULT_ID]: {
    id: TEXT_EMBEDDING_DEFAULT_ID,
    kind: "text-embedding",
    dimensions: 384,
    hfRepo: "Xenova/bge-small-en-v1.5",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "onnx/model_quantized.onnx",
    ],
    sizeBytes: 34_000_000,
  },
  [VISION_EMBEDDING_DEFAULT_ID]: {
    id: VISION_EMBEDDING_DEFAULT_ID,
    kind: "vision-embedding",
    dimensions: 512,
    hfRepo: "Xenova/clip-vit-base-patch32",
    files: [
      "config.json",
      "preprocessor_config.json",
      "onnx/vision_model_quantized.onnx",
    ],
    sizeBytes: 95_000_000,
  },
};

/**
 * Looks up a model descriptor by id.
 *
 * @usedBy modelDownloader, onnxEmbeddingProvider
 * @returns The descriptor or undefined when the id is unknown.
 */
export function findModel(id: string): ModelDescriptor | undefined {
  return MODELS[id];
}
