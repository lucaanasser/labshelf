/**
 * Coordinates AI ingestion for newly added or updated papers. Subscribes to
 * paper:added / paper:updated and drives the @labshelf/core pipeline through a
 * single-worker queue. Idempotent: skips papers whose contentHash matches the
 * last indexed run.
 */
import * as vscode from "vscode";
import type { EventBus, IEmbeddingProvider, ILogger, IResearchDatabase, LocalFileSystem } from "@labshelf/core";
import { EVENTS, runIngestion } from "@labshelf/core";
import type { AiMetadataStore } from "../../db/ai/aiMetadataStore.js";
import type { SqliteVectorStore } from "../../db/ai/sqliteVectorStore.js";
import { PdfTextExtractor } from "../pdf/pdfTextExtractor.js";
import { hashFile } from "../pdf/contentHash.js";

export interface AiIndexerDependencies {
  database: IResearchDatabase;
  eventBus: EventBus;
  logger: ILogger;
  embedder: IEmbeddingProvider;
  vectorStore: SqliteVectorStore;
  metadataStore: AiMetadataStore;
  extractor: PdfTextExtractor;
  // Async because a paper's folder is only known to the index: papers live in any collection folder under papers/.
  resolvePdfUri: (paperId: string) => Promise<vscode.Uri | null>;
  fileSystem: Pick<LocalFileSystem, "readFile">;
  enqueue: (job: () => Promise<void>) => void;
}

export class AiIndexer {
  constructor(private readonly deps: AiIndexerDependencies) {}

  /**
   * Subscribes to paper lifecycle events. Returns a disposer that detaches the
   * listeners — the caller should add it to the extension context.
   *
   * @returns Function that unsubscribes the indexer.
   */
  attach(): () => void {
    const onAdded = (payload: unknown): void => this.scheduleByPayload(payload);
    const onUpdated = (payload: unknown): void => this.scheduleByPayload(payload);
    const onDeleted = (payload: unknown): void => this.handleDeleted(payload);
    this.deps.eventBus.on(EVENTS.PAPER_ADDED, onAdded);
    this.deps.eventBus.on(EVENTS.PAPER_UPDATED, onUpdated);
    this.deps.eventBus.on(EVENTS.PAPER_DELETED, onDeleted);
    return () => {
      this.deps.eventBus.off(EVENTS.PAPER_ADDED, onAdded);
      this.deps.eventBus.off(EVENTS.PAPER_UPDATED, onUpdated);
      this.deps.eventBus.off(EVENTS.PAPER_DELETED, onDeleted);
    };
  }

  /**
   * Re-runs ingestion for every known paper. Used by the rebuild command.
   *
   * @returns void
   */
  async rebuildAll(): Promise<void> {
    const papers = await this.deps.database.listPapers();
    for (const paper of papers) this.scheduleIndex(paper.id);
  }

  private scheduleByPayload(payload: unknown): void {
    const paperId = readPaperId(payload);
    if (paperId) this.scheduleIndex(paperId);
  }

  private scheduleIndex(paperId: string): void {
    this.deps.enqueue(() => this.runIndex(paperId));
  }

  private async runIndex(paperId: string): Promise<void> {
    const pdfUri = await this.deps.resolvePdfUri(paperId);
    if (!pdfUri) return;
    this.deps.eventBus.emit(EVENTS.AI_INDEX_STARTED, { paperId });
    try {
      const hash = await hashFile(pdfUri, this.deps.fileSystem);
      const indexed = this.deps.metadataStore.listIndexed();
      if (indexed.get(paperId) === hash) return;
      const extracted = await this.deps.extractor.extract(paperId, pdfUri);
      const result = await runIngestion(extracted, {
        embedder: this.deps.embedder,
        vectorStore: this.deps.vectorStore,
      });
      this.deps.metadataStore.upsert(result.metadata, hash);
      this.deps.eventBus.emit(EVENTS.AI_INDEXED, {
        paperId,
        chunkCount: result.chunkCount,
        embeddedChunks: result.embeddedChunks,
      });
    } catch (error) {
      void this.deps.logger.error("ai/indexer", error, { paperId });
      this.deps.eventBus.emit(EVENTS.AI_INDEX_FAILED, { paperId });
    }
  }

  private handleDeleted(payload: unknown): void {
    const paperId = readPaperId(payload);
    if (!paperId) return;
    void this.deps.vectorStore.deleteByPaper(paperId);
    this.deps.metadataStore.delete(paperId);
  }
}

function readPaperId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { paperId?: unknown; id?: unknown }).paperId
    ?? (payload as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}
