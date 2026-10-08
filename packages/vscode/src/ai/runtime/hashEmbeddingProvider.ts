/**
 * Deterministic hash-based bag-of-words embedding provider. The same text
 * yields the same vector and cosine similarity is well-defined, with no model
 * files or native runtime involved.
 */
import type { IEmbeddingProvider } from "@labshelf/core";

const TOKEN_RE = /[A-Za-z][A-Za-z0-9'-]{1,}/g;

export class HashEmbeddingProvider implements IEmbeddingProvider {
  readonly modelId = "labshelf/hash-bow-384";
  readonly dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  /**
   * Produces a deterministic bag-of-words pseudo-embedding for each text.
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
