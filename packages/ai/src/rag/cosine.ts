/**
 * Float32-friendly cosine similarity. Embeddings produced by ONNX runtimes
 * arrive as Float32Array; converting them to plain arrays just to compute
 * dot-products would waste allocations. Kept dependency-free.
 *
 * @depends none
 * @dependents rag/stanceDetector.ts, rag/rerank.ts, analysis/titleDedupEmbedding
 */

/**
 * Cosine similarity between two equal-length vectors.
 *
 * @usedBy stanceDetector, rerank
 * @returns Value in [-1, 1].
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}
