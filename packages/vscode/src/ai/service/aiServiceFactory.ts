/**
 * Wires the AI subsystem together from the dependencies that extension.ts
 * already constructs (database, event bus, logger, paths). Returns null when
 * AI is disabled in settings. Embeddings come from the hash provider.
 */
import * as vscode from "vscode";
import type { EventBus, ILogger, LocalFileSystem, PdfDocumentOpener } from "@labshelf/core";
import { AiMetadataStore, ReadingEventsStore, SqliteVectorStore } from "../../db/ai/index.js";
import { SqliteResearchDatabase } from "../../db/sqliteResearchDatabase.js";
import { PdfTextExtractor } from "../pdf/pdfTextExtractor.js";
import { HashEmbeddingProvider } from "../runtime/index.js";
import { AiIndexer } from "../indexer/aiIndexer.js";
import { IndexerQueue } from "../indexer/indexerQueue.js";
import { AiService } from "./aiService.js";

export interface AiServiceFactoryDependencies {
  context: vscode.ExtensionContext;
  database: SqliteResearchDatabase;
  fileSystem: Pick<LocalFileSystem, "readFile">;
  eventBus: EventBus;
  logger: ILogger;
  pdfOpener: PdfDocumentOpener;
  resolvePdfUri: (paperId: string) => Promise<vscode.Uri | null>;
}

/**
 * Builds the AiService graph. Caller must dispose the indexer when activation
 * is torn down (returned in `dispose`).
 */
export async function createAiService(
  deps: AiServiceFactoryDependencies,
): Promise<{ service: AiService; dispose: () => void } | null> {
  const config = vscode.workspace.getConfiguration("labshelf.ai");
  if (config.get<boolean>("enabled") === false) return null;

  const rawConnection = deps.database.rawConnection();
  const embedder = new HashEmbeddingProvider();
  const vectorStore = new SqliteVectorStore(rawConnection, embedder.modelId);
  const metadataStore = new AiMetadataStore(rawConnection);
  const readingEvents = new ReadingEventsStore(rawConnection);
  const extractor = new PdfTextExtractor(deps.pdfOpener, deps.fileSystem);
  const queue = new IndexerQueue(deps.logger);
  const indexer = new AiIndexer({
    database: deps.database,
    eventBus: deps.eventBus,
    logger: deps.logger,
    embedder,
    vectorStore,
    metadataStore,
    extractor,
    resolvePdfUri: deps.resolvePdfUri,
    fileSystem: deps.fileSystem,
    enqueue: (job) => queue.enqueue(job),
  });
  const detach = indexer.attach();
  const service = new AiService({
    embedder,
    vectorStore,
    metadataStore,
    readingEvents,
    indexer,
    queue,
    eventBus: deps.eventBus,
    logger: deps.logger,
  });
  return { service, dispose: detach };
}
