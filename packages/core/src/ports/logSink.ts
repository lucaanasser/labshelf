/** Destination for log entries: a file, a database table or any other record of what the app did. */
import type { LogEntry } from "../model/index.js";

export interface LogSink {
  append(entry: LogEntry): Promise<void>;
}
