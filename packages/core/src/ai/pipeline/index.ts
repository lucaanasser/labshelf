/**
 * Barrel re-export for ingestion pipeline.
 */
export { extractMetadata } from "./extractMetadata.js";
export type { ExtractMetadataOptions } from "./extractMetadata.js";
export { runIngestion } from "./ingestionStages.js";
export type { IngestionContext, IngestionResult } from "./ingestionStages.js";
