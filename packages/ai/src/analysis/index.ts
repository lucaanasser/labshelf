/**
 * Barrel re-export for analysis utilities (post-ingestion / cross-paper).
 *
 * @depends heatmapAggregator.ts, citationGapDetector.ts, bibAudit.ts
 * @dependents vscode insights surfaces, writing diagnostics
 */
export { aggregateHeatmap } from "./heatmapAggregator.js";
export type { HeatmapCell, HeatmapMatrix } from "./heatmapAggregator.js";
export { detectCitationGaps } from "./citationGapDetector.js";
export type { CitationGap, ReferenceFromCorpus } from "./citationGapDetector.js";
export { auditBibliography } from "./bibAudit.js";
export type { BibAuditResult } from "./bibAudit.js";
