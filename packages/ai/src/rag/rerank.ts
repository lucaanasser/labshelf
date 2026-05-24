/**
 * Maximum Marginal Relevance (MMR) reranking. Diversifies the top-k results
 * by penalising candidates that are too similar to already selected ones.
 * Used when downstream UI displays a small fixed-size list (e.g. citation
 * popups, similar figures) and would benefit from coverage over redundancy.
 *
 * @depends ../types/vectorStore.ts, ./cosine.ts
 * @dependents vscode aiService surfaces
 */
import type { VectorMatch } from "../types/vectorStore.js";
import { cosine } from "./cosine.js";

export interface MmrOptions {
  lambda: number;
  topN: number;
}

/**
 * Reranks vector matches using MMR. Requires that each match carries its own
 * embedding (provided externally by the caller when needed).
 *
 * @usedBy citation popups, similar figures
 * @returns Up to topN diversified matches.
 */
export function mmrRerank(
  matches: { match: VectorMatch; embedding: Float32Array }[],
  queryEmbedding: Float32Array,
  options: MmrOptions,
): VectorMatch[] {
  const { lambda, topN } = options;
  const selected: typeof matches = [];
  const pool = [...matches];
  while (selected.length < topN && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      if (!candidate) continue;
      const relevance = cosine(candidate.embedding, queryEmbedding);
      const redundancy = selected.length
        ? Math.max(
            ...selected.map((s) => cosine(candidate.embedding, s.embedding)),
          )
        : 0;
      const mmr = lambda * relevance - (1 - lambda) * redundancy;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    const chosen = pool.splice(bestIdx, 1)[0];
    if (chosen) selected.push(chosen);
  }
  return selected.map((s) => s.match);
}
