/**
 * Types for reading-activity events feeding F17 (intellectual heatmap).
 *
 * Events are emitted by the PDF viewer in @labshelf/vscode and persisted to
 * the reading_events table. Aggregation runs server-side in this package.
 *
 * @depends none
 * @dependents analysis/heatmapAggregator, vscode pdf-viewer
 */
export type ReadingEventKind = "open" | "scroll" | "annotate" | "close";

export interface ReadingEvent {
  paperId: string;
  kind: ReadingEventKind;
  page?: number;
  occurredAt: number;
  durationMs?: number;
  topicCluster?: string;
}
