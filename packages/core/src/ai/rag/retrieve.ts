/**
 * Generic top-k retrieval. Embeds the query, hands it to the vector store, and
 * returns matches unchanged. Keeping this thin keeps store implementations in
 * charge of filtering and ranking.
 */
import type {
  IEmbeddingProvider,
  IVectorStore,
  VectorFilter,
  VectorMatch,
} from "../types/index.js";

export interface RetrieveOptions {
  k?: number;
  filter?: VectorFilter;
}

/**
 * Retrieves the top-k most similar chunks for a free-text query.
 *
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
