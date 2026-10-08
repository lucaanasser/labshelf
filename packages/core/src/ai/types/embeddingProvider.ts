/**
 * Platform-agnostic contract for text embedding providers.
 *
 * Concrete implementations live in consumer packages (e.g. the hash provider in
 * packages/vscode/src/ai/runtime). The pipeline never depends on a specific
 * model file; only on the dimensionality declared by the provider.
 */
export interface IEmbeddingProvider {
  readonly dimensions: number;
  readonly modelId: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}
