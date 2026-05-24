/**
 * Abstract vector store used by RAG and search features.
 *
 * VSCode implements this with sqlite-vec on top of SqliteResearchDatabase;
 * browser implementation may use a flat in-memory index. The contract is the
 * minimum needed for top-k retrieval with metadata filtering.
 *
 * @depends none
 * @dependents rag/retrieve, rag/stanceDetector, analysis/citationGapDetector
 */
export interface VectorRecord {
  id: number;
  paperId: string;
  kind: string;
  section?: string;
  page?: number;
  text?: string;
}

export interface VectorMatch extends VectorRecord {
  score: number;
}

export interface VectorFilter {
  paperIds?: string[];
  kinds?: string[];
  excludePaperIds?: string[];
}

export interface IVectorStore {
  upsert(records: { record: VectorRecord; embedding: Float32Array }[]): Promise<void>;
  search(embedding: Float32Array, k: number, filter?: VectorFilter): Promise<VectorMatch[]>;
  deleteByPaper(paperId: string): Promise<void>;
}
