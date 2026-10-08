import { Logger } from "../../src/logging/index";
import type { LogEntry } from "../../src/model/index";
import type { LogSink } from "../../src/ports/index";

const now = () => new Date("2026-01-02T03:04:05.000Z");

function recordingSink(): LogSink & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { entries, append: async (entry) => { entries.push(entry); } };
}

const failingSink: LogSink = { append: async () => { throw new Error("disk full"); } };

describe("Logger", () => {
  it("sends each entry to every sink", async () => {
    const a = recordingSink();
    const b = recordingSink();
    await new Logger([a, b], { now }).log("INFO", "mod", "hello", { k: 1 });
    const expected = { timestamp: "2026-01-02T03:04:05.000Z", level: "INFO", module: "mod", message: "hello", context: { k: 1 } };
    expect(a.entries).toEqual([expected]);
    expect(b.entries).toEqual([expected]);
  });

  it("error() logs the message and stack of an Error at ERROR level", async () => {
    const sink = recordingSink();
    const error = new Error("boom");
    await new Logger([sink], { now }).error("mod", error, { id: "p1" });
    expect(sink.entries[0]).toMatchObject({ level: "ERROR", module: "mod", message: "boom", stack: error.stack, context: { id: "p1" } });
  });

  it("error() records a non-Error without a stack", async () => {
    const sink = recordingSink();
    await new Logger([sink], { now }).error("mod", "just text");
    expect(sink.entries[0]?.message).toBe("just text");
    expect("stack" in (sink.entries[0] as LogEntry)).toBe(false);
  });

  it("a failing sink does not stop the others and does not reject", async () => {
    const good = recordingSink();
    const logger = new Logger([failingSink, good], { now });
    await expect(logger.log("INFO", "mod", "still delivered")).resolves.toBeUndefined();
    expect(good.entries).toHaveLength(1);
  });

  it("reports a sink failure with the entry that was lost", async () => {
    const onSinkError = jest.fn();
    await new Logger([failingSink], { now, onSinkError }).log("WARN", "mod", "lost");
    expect(onSinkError).toHaveBeenCalledTimes(1);
    const [error, entry] = onSinkError.mock.calls[0] as [Error, LogEntry];
    expect(error.message).toBe("disk full");
    expect(entry).toMatchObject({ level: "WARN", message: "lost" });
  });

  it("does not reject when onSinkError throws or no handler is set", async () => {
    await expect(new Logger([failingSink]).log("INFO", "m", "x")).resolves.toBeUndefined();
    const throwing = new Logger([failingSink], { onSinkError: () => { throw new Error("reporter"); } });
    await expect(throwing.log("INFO", "m", "x")).resolves.toBeUndefined();
  });

  it("does not wait for one sink before starting another", async () => {
    let release: () => void = () => undefined;
    const slow: LogSink = { append: () => new Promise<void>((resolve) => { release = resolve; }) };
    const fast = recordingSink();
    const pending = new Logger([slow, fast], { now }).log("INFO", "m", "x");
    await Promise.resolve();
    expect(fast.entries).toHaveLength(1);
    release();
    await pending;
  });
});
