/**
 * Generic top-k retrieval. Embeds the query, hands it to the vector store, and
 * returns matches unchanged. Keeping this thin keeps store implementations in
 * charge of filtering and ranking.
 *
 * @depends ../types/embeddingProvider.ts, ../types/vectorStore.ts
 * @dependents rag/stanceDetector.ts, vscode aiService search APIs
 */
import type { IEmbeddingProvider } from "../types/embeddingProvider.js";
import type {
  IVectorStore,
  VectorFilter,
  VectorMatch,
} from "../types/vectorStore.js";

export interface RetrieveOptions {
  k?: number;
  filter?: VectorFilter;
}

/**
 * Retrieves the top-k most similar chunks for a free-text query.
 *
 * @usedBy aiService.searchByText, searchByClaim, paraphrase guard
 * @returns Vector matches sorted by descending score.
 */
export async function retrieveTopK(
  query: string,
  embedder: IEmbeddingProvider,
  store: IVectorStore,
  options: RetrieveOptions = {},
): Promise<VectorMatch[]> {
  const k = options.k ?? 10;
  const [embedding] = await embedder.embed([query]);
  if (!embedding) return [];
  return store.search(embedding, k, options.filter);
}
