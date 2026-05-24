/**
 * F17 — Intellectual heatmap aggregator. Buckets reading events by week and
 * topic cluster, producing the matrix consumed by the InsightsHeatmapPanel
 * webview. Topic clusters are supplied by the caller (e.g. precomputed
 * embedding clusters or a fixed lexicon).
 *
 * @depends ../types/readingEvent.ts
 * @dependents vscode InsightsHeatmapPanel
 */
import type { ReadingEvent } from "../types/readingEvent.js";

export interface HeatmapCell {
  topic: string;
  weekStart: number;
  weight: number;
}

export interface HeatmapMatrix {
  topics: string[];
  weekStarts: number[];
  cells: HeatmapCell[];
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Aggregates reading events into a (topic × week) matrix with weight equal to
 * total reading duration in minutes.
 *
 * @usedBy InsightsHeatmapPanel
 * @returns Matrix with sorted topics and ascending week starts.
 */
export function aggregateHeatmap(events: ReadingEvent[]): HeatmapMatrix {
  const buckets = new Map<string, number>();
  const topics = new Set<string>();
  const weekStarts = new Set<number>();
  for (const ev of events) {
    if (!ev.topicCluster) continue;
    const weekStart = toWeekStart(ev.occurredAt);
    const key = `${ev.topicCluster}|${weekStart}`;
    const weight = (ev.durationMs ?? 0) / 60_000;
    buckets.set(key, (buckets.get(key) ?? 0) + weight);
    topics.add(ev.topicCluster);
    weekStarts.add(weekStart);
  }
  const sortedTopics = Array.from(topics).sort();
  const sortedWeeks = Array.from(weekStarts).sort((a, b) => a - b);
  const cells: HeatmapCell[] = [];
  for (const [key, weight] of buckets) {
    const [topic, weekRaw] = key.split("|");
    if (!topic || !weekRaw) continue;
    cells.push({ topic, weekStart: Number(weekRaw), weight });
  }
  return { topics: sortedTopics, weekStarts: sortedWeeks, cells };
}

function toWeekStart(timestamp: number): number {
  return Math.floor(timestamp / MS_PER_WEEK) * MS_PER_WEEK;
}
