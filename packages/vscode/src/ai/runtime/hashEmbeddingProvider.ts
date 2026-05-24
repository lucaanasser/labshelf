/**
 * Deterministic hash-based embedding provider. Used for testing and as the
 * fallback when the real ONNX runtime is unavailable (extension installed
 * without @xenova/transformers or onnxruntime-node). Quality is far below a
 * real model but the contract holds: same text yields the same vector,
 * cosine is well-defined.
 *
 * @depends @labshelf/ai (types)
 * @dependents ai/serviceFactory degraded path, unit tests
 */
import type { IEmbeddingProvider } from "@labshelf/ai";

const TOKEN_RE = /[A-Za-z][A-Za-z0-9'-]{1,}/g;

export class HashEmbeddingProvider implements IEmbeddingProvider {
  readonly modelId = "labshelf/hash-bow-384";
  readonly dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  /**
   * Produces a deterministic bag-of-words pseudo-embedding for each text.
   *
   * @usedBy degraded mode, unit tests
   * @returns L2-normalised Float32Array vectors.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions);
    const tokens = text.toLowerCase().match(TOKEN_RE) ?? [];
    for (const token of tokens) {
      const bucket = hash(token) % this.dimensions;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }
    return l2Normalise(vec);
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function l2Normalise(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += (v[i] ?? 0) ** 2;
  if (sumSq === 0) return v;
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
  return v;
}
