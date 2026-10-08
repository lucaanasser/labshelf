/** Logger that fans each entry out to every sink independently and never rejects. */
import type { LogEntry } from "../model/index.js";
import type { ILogger, LogSink } from "../ports/index.js";
import { createLogEntry, describeError } from "./logEntry.js";

export interface LoggerOptions {
  /** Called when a sink fails; the failing sink is the only one affected. */
  onSinkError?: (error: unknown, entry: LogEntry) => void;
  now?: () => Date;
}

export class Logger implements ILogger {
  constructor(
    private readonly sinks: readonly LogSink[],
    private readonly options: LoggerOptions = {},
  ) {}

  async log(
    level: LogEntry["level"],
    module: string,
    message: string,
    context: Record<string, unknown> = {},
    stack?: string,
  ): Promise<void> {
    const entry = createLogEntry(level, module, message, context, stack, this.options.now);
    await Promise.all(this.sinks.map((sink) => this.write(sink, entry)));
  }

  error(module: string, error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const { message, stack } = describeError(error);
    return this.log("ERROR", module, message, context, stack);
  }

  private async write(sink: LogSink, entry: LogEntry): Promise<void> {
    try {
      await sink.append(entry);
    } catch (error) {
      try {
        this.options.onSinkError?.(error, entry);
      } catch {
        // The error reporter itself failed; logging must never throw into the caller.
      }
    }
  }
}
