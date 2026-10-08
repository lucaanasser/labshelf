/** Appends log entries as JSON lines to a file, rotating to <file>.1 past a size limit. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LogEntry } from "../../model/index.js";
import type { LogSink } from "../../ports/index.js";
import { formatLogLine } from "../logEntry.js";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export interface FileLogSinkOptions {
  maxBytes?: number;
}

export class FileLogSink implements LogSink {
  private readonly maxBytes: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, options: FileLogSinkOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /** Writes are queued so concurrent callers never interleave lines; a failed write rejects only its own caller. */
  append(entry: LogEntry): Promise<void> {
    const write = this.queue.then(() => this.write(entry));
    this.queue = write.catch(() => undefined);
    return write;
  }

  private async write(entry: LogEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await this.rotateIfFull();
    await fs.appendFile(this.file, formatLogLine(entry));
  }

  private async rotateIfFull(): Promise<void> {
    const size = await fs.stat(this.file).then((stat) => stat.size, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });
    if (size > this.maxBytes) {
      await fs.rename(this.file, `${this.file}.1`);
    }
  }
}
