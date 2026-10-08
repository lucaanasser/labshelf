/** Builds the extension's logger: the rotating app.log file plus the SQLite log table. */
import { Logger, type ILogger, type LogSink } from "@labshelf/core";
import { FileLogSink } from "@labshelf/core/node";

/** The extension host console is the fallback channel when a sink fails. */
export function createExtensionLogger(appLogPath: string, database: LogSink): ILogger {
  return new Logger([new FileLogSink(appLogPath), database], {
    onSinkError: (error, entry) => {
      console.error("LabShelf: failed to write a log entry", { module: entry.module, message: entry.message, error });
    },
  });
}
