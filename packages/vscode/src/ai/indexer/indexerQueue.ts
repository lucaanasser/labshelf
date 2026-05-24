/**
 * Single-worker FIFO queue used to serialise ingestion jobs. Embedding work is
 * CPU-bound and benefits from concurrency=1 — running two pipelines in parallel
 * would just thrash the model. Failures are caught and reported so the queue
 * keeps draining even when a single paper blows up.
 *
 * @depends @labshelf/core (logger)
 * @dependents indexer/aiIndexer.ts
 */
import type { ILogger } from "@labshelf/core";

export type IndexerJob = () => Promise<void>;

export class IndexerQueue {
  private readonly pending: IndexerJob[] = [];
  private active = false;

  constructor(private readonly logger: ILogger) {}

  /**
   * Schedules a job to run after any currently in-flight or queued jobs.
   *
   * @usedBy aiIndexer event listeners
   * @returns void
   */
  enqueue(job: IndexerJob): void {
    this.pending.push(job);
    void this.drain();
  }

  /**
   * Returns the number of queued jobs (excluding the active one).
   *
   * @usedBy ai settings status
   * @returns Pending job count.
   */
  size(): number {
    return this.pending.length;
  }

  /**
   * Returns true when a job is currently running.
   *
   * @usedBy ai settings status
   * @returns Running flag.
   */
  isRunning(): boolean {
    return this.active;
  }

  private async drain(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift();
        if (!job) continue;
        try {
          await job();
        } catch (error) {
          void this.logger.error("ai/indexer-queue", error, { message: "Indexer job failed" });
        }
      }
    } finally {
      this.active = false;
    }
  }
}
