/**
 * Persistence for reading events. Used to feed the intellectual heatmap (F17)
 * and reading-session analytics. Bounded retention — caller may purge old
 * events with `pruneOlderThan` if needed.
 *
 * @depends node:sqlite, @labshelf/ai (types)
 * @dependents ai/aiService, pdf-viewer event hooks
 */
import type { DatabaseSync } from "node:sqlite";
import type { ReadingEvent } from "@labshelf/ai";

type Row = {
  paper_id: string;
  kind: string;
  page: number | null;
  duration_ms: number | null;
  topic_cluster: string | null;
  occurred_at: number;
};

export class ReadingEventsStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Appends a single reading event.
   *
   * @usedBy PdfViewerPanel event hooks
   * @returns void
   */
  append(event: ReadingEvent): void {
    this.db.prepare(
      `INSERT INTO reading_events
        (paper_id, kind, page, duration_ms, topic_cluster, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      event.paperId,
      event.kind,
      event.page ?? null,
      event.durationMs ?? null,
      event.topicCluster ?? null,
      event.occurredAt,
    );
  }

  /**
   * Returns events from `since` to now, ordered by occurredAt ascending.
   *
   * @usedBy heatmapAggregator caller
   * @returns Reading events within the window.
   */
  listSince(since: number): ReadingEvent[] {
    const rows = this.db
      .prepare(
        `SELECT paper_id, kind, page, duration_ms, topic_cluster, occurred_at
         FROM reading_events WHERE occurred_at >= ? ORDER BY occurred_at ASC`,
      )
      .all(since) as Row[];
    return rows.map(rowToEvent);
  }

  /**
   * Deletes events older than the given timestamp.
   *
   * @usedBy retention maintenance command
   * @returns Number of rows removed.
   */
  pruneOlderThan(timestamp: number): number {
    const result = this.db
      .prepare(`DELETE FROM reading_events WHERE occurred_at < ?`)
      .run(timestamp);
    return Number(result.changes ?? 0);
  }
}

function rowToEvent(row: Row): ReadingEvent {
  const event: ReadingEvent = {
    paperId: row.paper_id,
    kind: row.kind as ReadingEvent["kind"],
    occurredAt: row.occurred_at,
  };
  if (row.page !== null) event.page = row.page;
  if (row.duration_ms !== null) event.durationMs = row.duration_ms;
  if (row.topic_cluster !== null) event.topicCluster = row.topic_cluster;
  return event;
}
