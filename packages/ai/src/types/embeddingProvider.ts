/**
 * Platform-agnostic contract for text embedding providers.
 *
 * Concrete implementations live in consumer packages (e.g. ONNX runtime in
 * packages/vscode/src/ai/runtime). The pipeline never depends on a specific
 * model file; only on the dimensionality declared by the provider.
 *
 * @depends none
 * @dependents pipeline/ingestionStages, rag/retrieve, rag/stanceDetector
 */
export interface IEmbeddingProvider {
  readonly dimensions: number;
  readonly modelId: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface IVisionEmbeddingProvider {
  readonly dimensions: number;
  readonly modelId: string;
  embedImage(image: Uint8Array): Promise<Float32Array>;
}
