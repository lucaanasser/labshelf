/**
 * Structured log for the terminal app: one JSON LogEntry per line in <library>/.research/logs/terminal.log (the VS Code
 * extension writes the same format to app.log beside it). Never prints to the terminal, which belongs to the TUI.
 * Rotates to terminal.log.1 past 2 MB.
 *
 * @depends @labshelf/core (ILogger, LogEntry)
 * @dependents app/context, cli
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger, LogEntry } from "@labshelf/core";

const MAX_BYTES = 2 * 1024 * 1024;

export class FileLogger implements ILogger {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  log(level: LogEntry["level"], module: string, message: string, context: Record<string, unknown> = {}, stack?: string): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      context,
      ...(stack ? { stack } : {}),
    };
    // Serialized so concurrent writers never interleave half lines.
    this.queue = this.queue.then(() => this.append(entry)).catch(() => undefined);
    return this.queue;
  }

  error(module: string, error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error));
    return this.log("ERROR", module, err.message, context, err.stack);
  }

  private async append(entry: LogEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      if ((await fs.stat(this.file)).size > MAX_BYTES) {
        await fs.rename(this.file, `${this.file}.1`);
      }
    } catch {
      // No log yet.
    }
    await fs.appendFile(this.file, JSON.stringify(entry) + "\n");
  }
}
