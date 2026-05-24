/**
 * Thin Semantic Scholar Graph API client. The pure package owns the request
 * shape and response parsing only; runtime concerns (HTTP, caching, rate
 * limiting between requests) are partially handled here but kept simple
 * enough that VSCode-side adapters can wrap with persistent cache.
 *
 * @depends none
 * @dependents analysis/citationGapDetector consumers, vscode aiIndexer
 */

export interface SemanticScholarPaperRef {
  paperId: string;
  title?: string;
  year?: number;
  doi?: string;
  externalIds?: Record<string, string>;
}

export interface SemanticScholarLookup {
  paperId: string;
  references: SemanticScholarPaperRef[];
  citations: SemanticScholarPaperRef[];
}

export interface SemanticScholarClientOptions {
  fetchImpl: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  pauseBetweenRequestsMs?: number;
}

const DEFAULT_BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "title,year,externalIds,references.title,references.year,references.externalIds,citations.title,citations.year,citations.externalIds";

export class SemanticScholarClient {
  private lastRequestAt = 0;
  private readonly pauseMs: number;

  constructor(private readonly options: SemanticScholarClientOptions) {
    this.pauseMs = options.pauseBetweenRequestsMs ?? 1100;
  }

  /**
   * Fetches references and citations for a paper identified by DOI/arXiv.
   *
   * @usedBy aiIndexer S2 enrichment stage
   * @returns Parsed lookup or null on transient failure.
   */
  async lookup(externalId: string): Promise<SemanticScholarLookup | null> {
    await this.respectRate();
    const url = `${this.options.baseUrl ?? DEFAULT_BASE}/paper/${encodeURIComponent(externalId)}?fields=${encodeURIComponent(FIELDS)}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.apiKey) headers["x-api-key"] = this.options.apiKey;
    const response = await this.options.fetchImpl(url, { headers });
    if (!response.ok) return null;
    const data = (await response.json()) as RawPaper;
    return parsePaper(data);
  }

  private async respectRate(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + this.pauseMs - now;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }
}

interface RawPaper {
  paperId?: string;
  title?: string;
  references?: RawPaper[];
  citations?: RawPaper[];
}

function parsePaper(data: RawPaper): SemanticScholarLookup {
  return {
    paperId: data.paperId ?? "",
    references: (data.references ?? []).map(toRef),
    citations: (data.citations ?? []).map(toRef),
  };
}

function toRef(p: RawPaper): SemanticScholarPaperRef {
  const result: SemanticScholarPaperRef = { paperId: p.paperId ?? "" };
  if (p.title !== undefined) result.title = p.title;
  const raw = p as unknown as { year?: number; externalIds?: Record<string, string> };
  if (raw.year !== undefined) result.year = raw.year;
  if (raw.externalIds) {
    result.externalIds = raw.externalIds;
    const doi = raw.externalIds["DOI"];
    if (doi) result.doi = doi;
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
