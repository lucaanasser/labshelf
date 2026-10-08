/**
 * Structured log record shape consumed by file and database log sinks.
 */
export interface LogEntry {
  timestamp: string;
  level: "ERROR" | "WARN" | "INFO";
  module: string;
  message: string;
  stack?: string;
  context: Record<string, unknown>;
}
