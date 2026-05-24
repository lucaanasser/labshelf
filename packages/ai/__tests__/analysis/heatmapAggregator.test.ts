import { aggregateHeatmap } from "../../src/analysis/heatmapAggregator";
import type { ReadingEvent } from "../../src/types/readingEvent";

const WEEK = 7 * 24 * 60 * 60 * 1000;

describe("aggregateHeatmap", () => {
  it("buckets events by topic and week", () => {
    const events: ReadingEvent[] = [
      { paperId: "p1", kind: "open", occurredAt: WEEK * 100, durationMs: 60_000, topicCluster: "RAG" },
      { paperId: "p2", kind: "open", occurredAt: WEEK * 100 + 1000, durationMs: 120_000, topicCluster: "RAG" },
      { paperId: "p3", kind: "open", occurredAt: WEEK * 101, durationMs: 60_000, topicCluster: "Vision" },
    ];
    const matrix = aggregateHeatmap(events);
    expect(matrix.topics).toEqual(["RAG", "Vision"]);
    expect(matrix.weekStarts.length).toBe(2);
    const ragWeek1 = matrix.cells.find((c) => c.topic === "RAG");
    expect(ragWeek1!.weight).toBeGreaterThanOrEqual(3);
  });

  it("ignores events without topic", () => {
    const events: ReadingEvent[] = [{ paperId: "p", kind: "open", occurredAt: 0 }];
    const matrix = aggregateHeatmap(events);
    expect(matrix.topics).toEqual([]);
  });
});
