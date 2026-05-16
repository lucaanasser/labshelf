/**
 * Module: Logger
 * Responsibility: Write structured logs to disk and database adapters
 * Dependencies: vscode, workspace filesystem
 */
import * as vscode from "vscode";

import type { LogEntry } from "./types.js";
import { FileSystemService } from "../storage/fileSystemService.js";
import type { ILibraryPaths } from "../storage/paths/libraryPaths.js";

export interface LogStore {
  append(entry: LogEntry): Promise<void>;
}

export class WorkspaceLogger {
  constructor(
    private readonly fsService: FileSystemService,
    private readonly paths: ILibraryPaths,
    private readonly store?: LogStore,
  ) {}

  async log(level: LogEntry["level"], module: string, message: string, context: Record<string, unknown> = {}, stack?: string): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      context,
      ...(stack ? { stack } : {}),
    };

    await this.fsService.ensureDirectory(this.paths.logsRoot());
    const line = `${JSON.stringify(entry)}\n`;
    let previous = "";
    try {
      previous = await this.fsService.readText(this.paths.appLogPath());
    } catch {
      previous = "";
    }

    await vscode.workspace.fs.writeFile(this.paths.appLogPath(), Buffer.from(`${previous}${line}`, "utf8"));

    if (this.store) {
      await this.store.append(entry);
    }
  }

  async error(module: string, error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const stack = error instanceof Error ? error.stack : undefined;
    const message = error instanceof Error ? error.message : String(error);
    await this.log("ERROR", module, message, context, stack);
  }
}