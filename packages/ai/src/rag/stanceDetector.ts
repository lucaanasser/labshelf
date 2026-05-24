/**
 * F07 — Search by claim with stance classification. Detection runs without an
 * LLM: each retrieved chunk is compared against two anchor sentences using
 * the same embedding model that produced its index vector.
 *
 * @depends ../types/embeddingProvider.ts, ../types/vectorStore.ts, ../types/citationGraph.ts, ./cosine.ts, ./retrieve.ts
 * @dependents vscode searchByClaim feature
 */
import type { IEmbeddingProvider } from "../types/embeddingProvider.js";
import type { IVectorStore, VectorMatch } from "../types/vectorStore.js";
import type { ClaimSearchResult, Stance } from "../types/citationGraph.js";
import { cosine } from "./cosine.js";
import { retrieveTopK } from "./retrieve.js";

const SUPPORT_ANCHOR = "This supports the claim that the proposed approach succeeds.";
const CONTRADICT_ANCHOR = "This contradicts the claim and reports the opposite finding.";
const NEUTRAL_MARGIN = 0.04;

export interface StanceDetectorOptions {
  topK?: number;
  minimumScore?: number;
}

/**
 * Searches the corpus for evidence supporting or contradicting a claim.
 *
 * @usedBy vscode searchByClaim panel
 * @returns Results grouped by paper, each tagged with stance and best snippet.
 */
export async function searchByClaim(
  claim: string,
  embedder: IEmbeddingProvider,
  store: IVectorStore,
  options: StanceDetectorOptions = {},
): Promise<ClaimSearchResult[]> {
  const topK = options.topK ?? 20;
  const minimum = options.minimumScore ?? 0.2;
  const matches = await retrieveTopK(claim, embedder, store, { k: topK });
  if (matches.length === 0) return [];
  const [supportVec, contradictVec] = await embedder.embed([
    SUPPORT_ANCHOR,
    CONTRADICT_ANCHOR,
  ]);
  if (!supportVec || !contradictVec) return [];
  const results = matches
    .filter((m) => m.score >= minimum && m.text)
    .map((m) => classifyMatch(m, embedder, supportVec, contradictVec));
  return Promise.all(results).then((rs) => collapseByPaper(rs));
}

async function classifyMatch(
  match: VectorMatch,
  embedder: IEmbeddingProvider,
  supportVec: Float32Array,
  contradictVec: Float32Array,
): Promise<ClaimSearchResult> {
  const [chunkVec] = await embedder.embed([match.text ?? ""]);
  let stance: Stance = "neutral";
  if (chunkVec) {
    const sSupport = cosine(chunkVec, supportVec);
    const sContradict = cosine(chunkVec, contradictVec);
    if (sSupport - sContradict > NEUTRAL_MARGIN) stance = "support";
    else if (sContradict - sSupport > NEUTRAL_MARGIN) stance = "contradict";
  }
  return {
    paperId: match.paperId,
    stance,
    score: match.score,
    bestSnippet: match.text ?? "",
    ...(typeof match.page === "number" ? { page: match.page } : {}),
  };
}

function collapseByPaper(results: ClaimSearchResult[]): ClaimSearchResult[] {
  const best = new Map<string, ClaimSearchResult>();
  for (const r of results) {
    const cur = best.get(r.paperId);
    if (!cur || r.score > cur.score) best.set(r.paperId, r);
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score);
}
