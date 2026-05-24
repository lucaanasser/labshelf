import { IndexerQueue } from "../../../src/ai/indexer/indexerQueue";

class StubLogger {
  errors: { module: string; error: unknown; context?: unknown }[] = [];
  async log(): Promise<void> {}
  async error(module: string, error: unknown, context?: Record<string, unknown>): Promise<void> {
    this.errors.push({ module, error, context });
  }
}

describe("IndexerQueue", () => {
  it("runs jobs in FIFO order with concurrency 1", async () => {
    const queue = new IndexerQueue(new StubLogger() as never);
    const order: number[] = [];
    queue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(1);
    });
    queue.enqueue(async () => {
      order.push(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(order).toEqual([1, 2]);
  });

  it("keeps draining after a job throws", async () => {
    const logger = new StubLogger();
    const queue = new IndexerQueue(logger as never);
    const survivors: number[] = [];
    queue.enqueue(async () => {
      throw new Error("boom");
    });
    queue.enqueue(async () => {
      survivors.push(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(survivors).toEqual([1]);
    expect(logger.errors).toHaveLength(1);
  });

  it("reports queue size and running state", () => {
    const queue = new IndexerQueue(new StubLogger() as never);
    expect(queue.size()).toBe(0);
    expect(queue.isRunning()).toBe(false);
  });
});
