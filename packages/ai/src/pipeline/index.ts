/**
 * Barrel re-export for ingestion pipeline.
 *
 * @depends extractMetadata.ts, ingestionStages.ts
 * @dependents vscode aiIndexer
 */
export { extractMetadata } from "./extractMetadata.js";
export type { ExtractMetadataOptions } from "./extractMetadata.js";
export { runIngestion } from "./ingestionStages.js";
export type { IngestionContext, IngestionResult } from "./ingestionStages.js";
