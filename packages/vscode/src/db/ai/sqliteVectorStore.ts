/**
 * IVectorStore backed by SQLite BLOB storage and a JS flat-scan cosine top-k.
 * Adequate up to ~10k chunks; beyond that, swap in sqlite-vec without changing
 * the contract. We deliberately keep search() in-process (no SQL UDFs) so the
 * vector math runs on the same Float32Array layout used by the embedder.
 *
 * @depends node:sqlite, @labshelf/ai (types, rag/cosine), ./embeddingCodec.ts
 * @dependents ai/aiIndexer, ai/aiService
 */
import type { DatabaseSync } from "node:sqlite";
import type {
  IVectorStore,
  VectorFilter,
  VectorMatch,
  VectorRecord,
} from "@labshelf/ai";
import { cosine } from "@labshelf/ai";
import { decodeEmbedding, encodeEmbedding } from "./embeddingCodec.js";

type ChunkRow = {
  id: number;
  paper_id: string;
  kind: string;
  section: string | null;
  page: number | null;
  text: string | null;
  embedding: Uint8Array;
  dim: number;
};

export class SqliteVectorStore implements IVectorStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly modelId: string,
  ) {}

  /**
   * Inserts or replaces vector records for the given chunks.
   *
   * @usedBy aiIndexer ingestion stage
   * @returns void
   */
  async upsert(
    records: { record: VectorRecord; embedding: Float32Array }[],
  ): Promise<void> {
    if (records.length === 0) return;
    const paperIds = Array.from(new Set(records.map((r) => r.record.paperId)));
    for (const pid of paperIds) {
      this.db.prepare(`DELETE FROM chunk_embeddings WHERE paper_id = ?`).run(pid);
    }
    const insert = this.db.prepare(
      `INSERT INTO chunk_embeddings
        (paper_id, kind, section, page, text, embedding, dim, model_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const { record, embedding } of records) {
      insert.run(
        record.paperId,
        record.kind,
        record.section ?? null,
        record.page ?? null,
        record.text ?? null,
        encodeEmbedding(embedding),
        embedding.length,
        this.modelId,
        now,
      );
    }
  }

  /**
   * Returns top-k chunks by cosine similarity to the query embedding.
   *
   * @usedBy aiService.searchByText, searchByClaim
   * @returns Matches sorted by descending score.
   */
  async search(
    query: Float32Array,
    k: number,
    filter?: VectorFilter,
  ): Promise<VectorMatch[]> {
    const rows = this.loadCandidates(filter);
    const scored: VectorMatch[] = rows.map((row) => ({
      id: row.id,
      paperId: row.paper_id,
      kind: row.kind,
      ...(row.section !== null ? { section: row.section } : {}),
      ...(row.page !== null ? { page: row.page } : {}),
      ...(row.text !== null ? { text: row.text } : {}),
      score: cosine(query, decodeEmbedding(row.embedding, row.dim)),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /**
   * Removes all chunks for a given paper.
   *
   * @usedBy aiService.deletePaper
   * @returns void
   */
  async deleteByPaper(paperId: string): Promise<void> {
    this.db.prepare(`DELETE FROM chunk_embeddings WHERE paper_id = ?`).run(paperId);
  }

  private loadCandidates(filter?: VectorFilter): ChunkRow[] {
    let sql = `SELECT id, paper_id, kind, section, page, text, embedding, dim FROM chunk_embeddings`;
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter?.paperIds && filter.paperIds.length > 0) {
      where.push(`paper_id IN (${filter.paperIds.map(() => "?").join(",")})`);
      params.push(...filter.paperIds);
    }
    if (filter?.excludePaperIds && filter.excludePaperIds.length > 0) {
      where.push(
        `paper_id NOT IN (${filter.excludePaperIds.map(() => "?").join(",")})`,
      );
      params.push(...filter.excludePaperIds);
    }
    if (filter?.kinds && filter.kinds.length > 0) {
      where.push(`kind IN (${filter.kinds.map(() => "?").join(",")})`);
      params.push(...filter.kinds);
    }
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    return this.db.prepare(sql).all(...params) as ChunkRow[];
  }
}
