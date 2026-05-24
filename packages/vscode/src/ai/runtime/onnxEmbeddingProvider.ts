/**
 * Real ONNX-backed embedding provider. Uses @xenova/transformers via lazy
 * dynamic import so the extension still loads (with degraded HashEmbedding-
 * Provider) when those optional deps are missing.
 *
 * @depends @labshelf/ai (types), vscode, ./modelManifest.ts
 * @dependents service/aiServiceFactory.ts
 */
import * as vscode from "vscode";
import type { IEmbeddingProvider } from "@labshelf/ai";
import { findModel, TEXT_EMBEDDING_DEFAULT_ID } from "./modelManifest.js";
import { resolveModelPaths } from "./modelPaths.js";

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

interface TransformersModule {
  env: { localModelPath?: string; allowRemoteModels?: boolean };
  pipeline: (task: "feature-extraction", model: string) => Promise<FeatureExtractionPipeline>;
}

export class OnnxEmbeddingProvider implements IEmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(
    private readonly globalStorage: vscode.Uri,
    modelId: string = TEXT_EMBEDDING_DEFAULT_ID,
  ) {
    const descriptor = findModel(modelId);
    if (!descriptor) throw new Error(`Unknown model id: ${modelId}`);
    this.modelId = modelId;
    this.dimensions = descriptor.dimensions;
  }

  /**
   * Produces real BGE/MiniLM-quality embeddings via ONNX runtime.
   *
   * @usedBy aiIndexer, aiService search
   * @returns L2-normalised Float32Array vectors, one per input text.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const pipeline = await this.ensurePipeline();
    const out: Float32Array[] = [];
    for (const text of texts) {
      const result = await pipeline([text], { pooling: "mean", normalize: true });
      out.push(new Float32Array(result.data));
    }
    return out;
  }

  private async ensurePipeline(): Promise<FeatureExtractionPipeline> {
    if (this.pipelinePromise) return this.pipelinePromise;
    this.pipelinePromise = this.loadPipeline();
    return this.pipelinePromise;
  }

  private async loadPipeline(): Promise<FeatureExtractionPipeline> {
    const transformers = await loadTransformers();
    const paths = resolveModelPaths(this.globalStorage, this.modelId);
    transformers.env.localModelPath = paths.root.fsPath;
    transformers.env.allowRemoteModels = false;
    return transformers.pipeline("feature-extraction", this.modelId);
  }
}

async function loadTransformers(): Promise<TransformersModule> {
  try {
    const specifier = "@xenova/transformers";
    const mod = (await import(specifier)) as unknown as TransformersModule;
    return mod;
  } catch (error) {
    throw new Error(
      "@xenova/transformers is not installed. Install it to enable real ONNX embeddings; the extension falls back to a hash-based provider in the meantime.",
      { cause: error as Error },
    );
  }
}
