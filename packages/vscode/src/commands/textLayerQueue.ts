/**
 * Runs "make this scanned paper searchable" jobs one at a time, in the
 * background, with visible and cancellable progress. Reading a page takes
 * seconds, so a paper is imported first and gains its text layer afterwards
 * rather than holding the import for a minute.
 *
 * @depends vscode, core/paperService.ts, core/logger.ts
 * @dependents commands/importProgress.ts, commands/registerCommands.ts
 */
import * as vscode from "vscode";

import type { PaperRecord } from "@labshelf/core";
import type { MakeSearchableResult, PaperService } from "../core/paperService.js";
import type { WorkspaceLogger } from "../core/logger.js";
import type { TextLayerProgress } from "../pdf/searchablePdfBuilder.js";

const LOG_MODULE = "commands/textLayerQueue";

export interface TextLayerQueueOptions {
  logger?: WorkspaceLogger | undefined;
  // Also tell the user when a paper needed nothing or could not be read —
  // wanted when they asked for it, noise after an import.
  announceAll?: boolean;
}

// One OCR worker serves the whole extension; jobs queue behind each other.
let tail: Promise<void> = Promise.resolve();

/**
 * Queues the given papers to receive a text layer if they lack one.
 * @usedBy commands/importProgress.ts, commands/registerCommands.ts
 * @returns a promise settled when these papers have been processed
 */
export function queueTextLayers(
  paperService: PaperService,
  papers: PaperRecord[],
  options: TextLayerQueueOptions = {},
): Promise<void> {
  for (const paper of papers) {
    tail = tail.then(() => processPaper(paperService, paper, options)).catch(() => undefined);
  }
  return tail;
}

async function processPaper(paperService: PaperService, paper: PaperRecord, options: TextLayerQueueOptions): Promise<void> {
  const progress = new LazyProgress(paper.title);
  let result: MakeSearchableResult;
  try {
    result = await paperService.makeSearchable(paper.id, {
      onProgress: (step) => progress.report(step),
      isCancelled: () => progress.cancelled,
    });
  } catch (error) {
    result = { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    progress.finish();
  }

  await options.logger?.log(result.status === "unavailable" ? "WARN" : "INFO", LOG_MODULE, "Text layer job finished", {
    paperId: paper.id,
    status: result.status,
    ...(result.status === "added" ? { pagesAdded: result.pagesAdded, pagesFailed: result.pagesFailed } : {}),
    ...(result.status === "unavailable" ? { reason: result.reason } : {}),
  });

  const message = describeOutcome(paper.title, result, options.announceAll === true);
  if (message) {
    void vscode.window.showInformationMessage(`LabShelf: ${message}`);
  }
}

/**
 * Builds the message shown when a job ends.
 * @usedBy commands/textLayerQueue.ts
 * @returns the text, or undefined when the outcome is not worth interrupting for
 */
export function describeOutcome(title: string, result: MakeSearchableResult, announceAll: boolean): string | undefined {
  switch (result.status) {
    case "added": {
      const pages = `${result.pagesAdded} page${result.pagesAdded === 1 ? "" : "s"} read`;
      const failed = result.pagesFailed > 0 ? `, ${result.pagesFailed} could not be` : "";
      return `"${title}" is now searchable (${pages}${failed}). Reopen it if it is already open.`;
    }
    case "cancelled":
      return `Stopped making "${title}" searchable; the paper was left as it was.`;
    case "not-needed":
      return announceAll ? `"${title}" already has a text layer.` : undefined;
    case "unavailable":
      return announceAll ? `Could not make "${title}" searchable: ${result.reason}.` : undefined;
  }
}

/**
 * Builds the progress line for one page.
 * @usedBy commands/textLayerQueue.ts
 * @returns e.g. `Making "Title" searchable — reading page 3 of 17…`
 */
export function describePage(title: string, step: TextLayerProgress): string {
  return `Making "${title}" searchable — reading page ${step.index} of ${step.total}…`;
}

// Most papers already have text and are checked in a fraction of a second. The
// notification therefore opens only once a page actually has to be read.
class LazyProgress {
  cancelled = false;
  private reporter: vscode.Progress<{ message?: string; increment?: number }> | undefined;
  private done: (() => void) | undefined;

  constructor(private readonly title: string) {}

  report(step: TextLayerProgress): void {
    if (!this.reporter && !this.done) {
      const finished = new Promise<void>((resolve) => { this.done = resolve; });
      void vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "LabShelf", cancellable: true },
        (reporter, token) => {
          this.reporter = reporter;
          token.onCancellationRequested(() => { this.cancelled = true; });
          reporter.report({ message: describePage(this.title, step) });
          return finished;
        },
      );
      return;
    }
    this.reporter?.report({ message: describePage(this.title, step), increment: 100 / step.total });
  }

  finish(): void {
    this.done?.();
  }
}
