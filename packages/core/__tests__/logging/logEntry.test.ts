import { createLogEntry, describeError, formatLogLine } from "../../src/logging/index";

describe("createLogEntry", () => {
  const now = () => new Date("2026-01-02T03:04:05.678Z");

  it("builds the entry shape with an ISO UTC timestamp", () => {
    expect(createLogEntry("INFO", "sync", "done", { id: 1 }, undefined, now)).toEqual({
      timestamp: "2026-01-02T03:04:05.678Z",
      level: "INFO",
      module: "sync",
      message: "done",
      context: { id: 1 },
    });
  });

  it("defaults the context to an empty object and omits an absent stack", () => {
    const entry = createLogEntry("WARN", "m", "msg", undefined, undefined, now);
    expect(entry.context).toEqual({});
    expect("stack" in entry).toBe(false);
  });

  it("keeps the stack when given", () => {
    expect(createLogEntry("ERROR", "m", "msg", {}, "at x", now).stack).toBe("at x");
  });
});

describe("describeError", () => {
  it("returns the message and stack of an Error", () => {
    const error = new Error("boom");
    expect(describeError(error)).toEqual({ message: "boom", stack: error.stack });
  });

  it("stringifies non-errors without inventing a stack", () => {
    expect(describeError("plain")).toEqual({ message: "plain" });
    expect(describeError({ code: 7 })).toEqual({ message: "[object Object]" });
    expect(describeError(undefined)).toEqual({ message: "undefined" });
  });
});

describe("formatLogLine", () => {
  it("is the entry as JSON followed by one newline", () => {
    const entry = createLogEntry("INFO", "m", "msg", { a: 1 }, undefined, () => new Date(0));
    const line = formatLogLine(entry);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
    expect(JSON.parse(line)).toEqual(entry);
  });
});
