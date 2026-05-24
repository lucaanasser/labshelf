/**
 * Barrel re-export for external integrations.
 *
 * @depends semanticScholar.ts
 * @dependents vscode aiIndexer enrichment stage
 */
export { SemanticScholarClient } from "./semanticScholar.js";
export type {
  SemanticScholarClientOptions,
  SemanticScholarLookup,
  SemanticScholarPaperRef,
} from "./semanticScholar.js";
