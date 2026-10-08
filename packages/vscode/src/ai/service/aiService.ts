/**
 * Façade over the AI subsystem. UI surfaces, commands, and other services
 * interact with the AI feature set exclusively through this interface — that
 * preserves the no-direct-DB-from-UI rule and gives us one place to swap or
 * stub the implementation in tests.
 */
import type {
  AiPaperMetadata,
  ClaimSearchResult,
  EventBus,
  IEmbeddingProvider,
  ILogger,
  ReadingEvent,
  VectorFilter,
  VectorMatch,
} from "@labshelf/core";
import { retrieveTopK, searchByClaim as runSearchByClaim } from "@labshelf/core";
import type { SqliteVectorStore } from "../../db/ai/sqliteVectorStore.js";
import type { AiMetadataStore } from "../../db/ai/aiMetadataStore.js";
import type { ReadingEventsStore } from "../../db/ai/readingEventsStore.js";
import type { AiIndexer } from "../indexer/aiIndexer.js";
import type { IndexerQueue } from "../indexer/indexerQueue.js";

export interface AiServiceStatus {
  embeddingModelId: string;
  embeddingDimensions: number;
  queuedJobs: number;
  running: boolean;
}

export interface AiServiceDependencies {
  embedder: IEmbeddingProvider;
  vectorStore: SqliteVectorStore;
  metadataStore: AiMetadataStore;
  readingEvents: ReadingEventsStore;
  indexer: AiIndexer;
  queue: IndexerQueue;
  eventBus: EventBus;
  logger: ILogger;
}

export class AiService {
  constructor(private readonly deps: AiServiceDependencies) {}

  /**
   * Top-k semantic search across all indexed chunks.
   *
   * @returns Matches sorted by descending score.
   */
  async searchByText(query: string, k = 10, filter?: VectorFilter): Promise<VectorMatch[]> {
    return retrieveTopK(query, this.deps.embedder, this.deps.vectorStore, {
      k,
      ...(filter ? { filter } : {}),
    });
  }

  /**
   * Stance-classified search for a claim sentence.
   *
   * @returns Per-paper results with support/contradict/neutral labels.
   */
  async searchByClaim(claim: string): Promise<ClaimSearchResult[]> {
    return runSearchByClaim(claim, this.deps.embedder, this.deps.vectorStore);
  }

  /**
   * Retrieves the cached AI metadata for a paper.
   *
   * @returns Metadata or null when the paper is not yet indexed.
   */
  getMetadata(paperId: string): AiPaperMetadata | null {
    return this.deps.metadataStore.get(paperId);
  }

  /**
   * Appends a reading event to the analytics store.
   *
   * @returns void
   */
  recordReadingEvent(event: ReadingEvent): void {
    this.deps.readingEvents.append(event);
  }

  /**
   * Triggers a full reindex of every paper in the library.
   *
   * @returns void
   */
  async rebuildAll(): Promise<void> {
    await this.deps.indexer.rebuildAll();
  }

  /**
   * Returns a snapshot of indexer status for the settings panel.
   *
   * @returns AiServiceStatus
   */
  status(): AiServiceStatus {
    return {
      embeddingModelId: this.deps.embedder.modelId,
      embeddingDimensions: this.deps.embedder.dimensions,
      queuedJobs: this.deps.queue.size(),
      running: this.deps.queue.isRunning(),
    };
  }
}
