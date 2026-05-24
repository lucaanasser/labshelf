/**
 * Persistence for AiPaperMetadata. Stored as JSON-typed text columns to keep
 * schema simple; structured queries (e.g. method facet search) go through the
 * methods/datasets indexes that aiSchema declares.
 *
 * @depends node:sqlite, @labshelf/ai (types)
 * @dependents ai/aiIndexer, ai/aiService
 */
import type { DatabaseSync } from "node:sqlite";
import type { AiPaperMetadata } from "@labshelf/ai";

type Row = {
  paper_id: string;
  methods: string;
  datasets: string;
  code_repos: string;
  reproducibility: string;
  compute: string | null;
  limitations: string;
  difficulty_profile: string;
  indexed_at: number;
  content_hash: string | null;
};

export class AiMetadataStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Inserts or replaces the AI metadata record for a paper.
   *
   * @usedBy aiIndexer ingestion stage
   * @returns void
   */
  upsert(metadata: AiPaperMetadata, contentHash?: string): void {
    this.db.prepare(
      `INSERT INTO paper_metadata_ai
        (paper_id, methods, datasets, code_repos, reproducibility, compute,
         limitations, difficulty_profile, indexed_at, content_hash)
       VALUES (@paper_id, @methods, @datasets, @code_repos, @reproducibility, @compute,
         @limitations, @difficulty_profile, @indexed_at, @content_hash)
       ON CONFLICT(paper_id) DO UPDATE SET
         methods=excluded.methods,
         datasets=excluded.datasets,
         code_repos=excluded.code_repos,
         reproducibility=excluded.reproducibility,
         compute=excluded.compute,
         limitations=excluded.limitations,
         difficulty_profile=excluded.difficulty_profile,
         indexed_at=excluded.indexed_at,
         content_hash=excluded.content_hash`,
    ).run({
      paper_id: metadata.paperId,
      methods: JSON.stringify(metadata.methods),
      datasets: JSON.stringify(metadata.datasets),
      code_repos: JSON.stringify(metadata.codeRepos),
      reproducibility: JSON.stringify(metadata.reproducibility),
      compute: metadata.compute ? JSON.stringify(metadata.compute) : null,
      limitations: JSON.stringify(metadata.limitations),
      difficulty_profile: JSON.stringify(metadata.difficultyProfile),
      indexed_at: metadata.indexedAt,
      content_hash: contentHash ?? null,
    });
  }

  /**
   * Reads the AI metadata for a single paper.
   *
   * @usedBy list panel detail cards, search facets
   * @returns Metadata snapshot or null when unindexed.
   */
  get(paperId: string): AiPaperMetadata | null {
    const row = this.db
      .prepare(`SELECT * FROM paper_metadata_ai WHERE paper_id = ?`)
      .get(paperId) as Row | undefined;
    return row ? rowToMetadata(row) : null;
  }

  /**
   * Lists indexed paper ids together with their content hashes.
   *
   * @usedBy aiIndexer (idempotency check)
   * @returns Map of paperId to contentHash (when present).
   */
  listIndexed(): Map<string, string | null> {
    const rows = this.db
      .prepare(`SELECT paper_id, content_hash FROM paper_metadata_ai`)
      .all() as { paper_id: string; content_hash: string | null }[];
    const out = new Map<string, string | null>();
    for (const r of rows) out.set(r.paper_id, r.content_hash);
    return out;
  }

  /**
   * Removes the metadata row for a paper. Vector and reading event tables
   * cascade via the FK on paper_id.
   *
   * @usedBy paper:deleted handler
   * @returns void
   */
  delete(paperId: string): void {
    this.db.prepare(`DELETE FROM paper_metadata_ai WHERE paper_id = ?`).run(paperId);
  }
}

function rowToMetadata(row: Row): AiPaperMetadata {
  const result: AiPaperMetadata = {
    paperId: row.paper_id,
    methods: JSON.parse(row.methods) as string[],
    datasets: JSON.parse(row.datasets) as string[],
    codeRepos: JSON.parse(row.code_repos) as AiPaperMetadata["codeRepos"],
    reproducibility: JSON.parse(row.reproducibility) as AiPaperMetadata["reproducibility"],
    limitations: JSON.parse(row.limitations) as string[],
    difficultyProfile: JSON.parse(row.difficulty_profile) as Record<number, number>,
    indexedAt: row.indexed_at,
  };
  if (row.compute) {
    result.compute = JSON.parse(row.compute) as NonNullable<AiPaperMetadata["compute"]>;
  }
  return result;
}
