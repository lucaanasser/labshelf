/**
 * BrowserLogger implements `ILogger` from @labshelf/core. Writes to the console
 * and to a small ring buffer in `bx.storage.local` so the options page can
 * display recent activity for troubleshooting.
 * @depends @labshelf/core ILogger, browserApi.
 * @dependents background, sync, capture flows (all Phase 2+).
 */
import type { ILogger, LogEntry } from "@labshelf/core";
import { bx } from "./browserApi";

const STORAGE_KEY = "labshelf.log.ring";
const RING_CAPACITY = 200;

export class BrowserLogger implements ILogger {
  private buffer: LogEntry[] = [];
  private hydrated = false;
  private hydration?: Promise<void>;

  constructor(private readonly defaultModule: string = "browser") {}

  async log(
    level: LogEntry["level"],
    module: string,
    message: string,
    context: Record<string, unknown> = {},
    stack?: string,
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      context,
      ...(stack !== undefined ? { stack } : {}),
    };
    this.emitConsole(entry);
    await this.persist(entry);
  }

  async error(module: string, error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    await this.log("ERROR", module, message, context, stack);
  }

  async info(message: string, context: Record<string, unknown> = {}): Promise<void> {
    await this.log("INFO", this.defaultModule, message, context);
  }

  async warn(message: string, context: Record<string, unknown> = {}): Promise<void> {
    await this.log("WARN", this.defaultModule, message, context);
  }

  async recent(): Promise<LogEntry[]> {
    await this.hydrate();
    return [...this.buffer];
  }

  private async persist(entry: LogEntry): Promise<void> {
    await this.hydrate();
    this.buffer.push(entry);
    if (this.buffer.length > RING_CAPACITY) {
      this.buffer.splice(0, this.buffer.length - RING_CAPACITY);
    }
    try {
      await bx.storage.local.set({ [STORAGE_KEY]: this.buffer });
    } catch {
      // Storage may be quota-restricted; in-memory copy is still valid.
    }
  }

  private emitConsole(entry: LogEntry): void {
    const prefix = `[labshelf:${entry.module}]`;
    if (entry.level === "ERROR") {
      // eslint-disable-next-line no-console
      console.error(prefix, entry.message, entry.context);
    } else if (entry.level === "WARN") {
      // eslint-disable-next-line no-console
      console.warn(prefix, entry.message, entry.context);
    } else {
      // eslint-disable-next-line no-console
      console.info(prefix, entry.message, entry.context);
    }
  }

  private hydrate(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydration) return this.hydration;
    this.hydration = (async () => {
      try {
        const stored = await bx.storage.local.get(STORAGE_KEY);
        const raw = stored[STORAGE_KEY];
        if (Array.isArray(raw)) {
          this.buffer = raw as LogEntry[];
        }
      } catch {
        // ignore — fresh buffer is fine
      }
      this.hydrated = true;
    })();
    return this.hydration;
  }
}
