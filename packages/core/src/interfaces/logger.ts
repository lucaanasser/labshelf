/**
 * Structured logger interface used by services and adapters across platforms.
 * Concrete implementations write to a workspace log file (VS Code) or a
 * ring buffer in extension storage (browser).
 *
 * @depends types/logEntry.ts
 * @dependents paperService, syncController, capture flows
 */
import type { LogEntry } from "../types/logEntry.js";

export interface ILogger {
  log(
    level: LogEntry["level"],
    module: string,
    message: string,
    context?: Record<string, unknown>,
    stack?: string,
  ): Promise<void>;
  error(module: string, error: unknown, context?: Record<string, unknown>): Promise<void>;
}
