/**
 * Runs text-layer jobs one at a time, in the background. An "ocr" job gives a
 * scanned paper a searchable text layer, with visible and cancellable progress;
 * a "check" job only records whether the PDF has text of its own, and is
 * silent. Reading a page takes seconds, so a paper is imported first and gains
 * its text layer afterwards rather than holding the import for a minute.
 *
 * The jobs waiting or running are published (currentTextLayerJobs,
 * onTextLayerJobsChanged) so the library list can show them on each row.
 *
 * @depends vscode, core/paperService.ts
 * @dependents commands/importProgress.ts, commands/registerCommands.ts, extension.ts
 */
import * as vscode from "vscode";

import type { ILogger, PaperRecord } from "@labshelf/core";
import type { MakeSearchableResult, PaperService } from "../core/paperService.js";
import type { TextLayerProgress } from "../pdf/searchablePdfBuilder.js";

const LOG_MODULE = "commands/textLayerQueue";

/** ocr: check, then read the pages if the PDF has no text. check: classify only. */
export type TextLayerJobMode = "ocr" | "check";

/** A paper waiting for, or in the middle of, OCR — as the library list shows it. */
export interface TextLayerJob {
  paperId: string;
  phase: "queued" | "reading";
  // reading: 1-based position among the pages being read.
  page?: number;
  total?: number;
}

export interface TextLayerQueueOptions {
  mode?: TextLayerJobMode;
  logger?: ILogger | undefined;
  // Also tell the user when a paper needed nothing or could not be read —
  // wanted when they asked for it, noise after an import.
  announceAll?: boolean;
}

// One OCR worker serves the whole extension; jobs queue behind each other.
let tail: Promise<void> = Promise.resolve();
// Papers queued and not yet finished, with the mode they will run in. A paper
// is queued once; asking for OCR on a paper waiting for a check upgrades it.
const pending = new Map<string, TextLayerJobMode>();
const reading = new Map<string, TextLayerJob>();
const listeners = new Set<(jobs: TextLayerJob[]) => void>();

/**
 * Queues the given papers. Papers already waiting are not queued twice.
 * @usedBy commands/importProgress.ts, commands/registerCommands.ts, extension.ts
 * @returns a promise settled when these papers have been processed
 */
export function queueTextLayers(
  paperService: PaperService,
  papers: PaperRecord[],
  options: TextLayerQueueOptions = {},
): Promise<void> {
  const mode = options.mode ?? "ocr";
  for (const paper of papers) {
    const waiting = pending.get(paper.id);
    if (waiting) {
      if (mode === "ocr" && waiting === "check") {
        pending.set(paper.id, "ocr");
        notify();
      }
      continue;
    }
    pending.set(paper.id, mode);
    tail = tail.then(() => runJob(paperService, paper, options)).catch(() => undefined);
  }
  notify();
  return tail;
}

/**
 * The OCR jobs waiting or running, oldest first. Silent checks are left out:
 * they take a fraction of a second and would only make rows flicker.
 * @usedBy extension.ts (list panel), commands/textLayerQueue.ts
 * @returns a snapshot of the jobs
 */
export function currentTextLayerJobs(): TextLayerJob[] {
  const jobs: TextLayerJob[] = [];
  for (const [paperId, mode] of pending) {
    if (mode === "ocr") {
      jobs.push(reading.get(paperId) ?? { paperId, phase: "queued" });
    }
  }
  return jobs;
}

/**
 * Calls the listener with a fresh snapshot whenever a job is queued, advances
 * a page, or finishes.
 * @usedBy extension.ts (list panel)
 * @returns a disposable that stops the notifications
 */
export function onTextLayerJobsChanged(listener: (jobs: TextLayerJob[]) => void): vscode.Disposable {
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}

function notify(): void {
  const jobs = currentTextLayerJobs();
  for (const listener of listeners) {
    try {
      listener(jobs);
    } catch {
      // A failing view must not stop the queue.
    }
  }
}

async function runJob(paperService: PaperService, paper: PaperRecord, options: TextLayerQueueOptions): Promise<void> {
  // Read at start, not at queue time: an explicit request may have upgraded it.
  const mode = pending.get(paper.id) ?? options.mode ?? "ocr";
  try {
    if (mode === "check") {
      await runCheck(paperService, paper, options);
    } else {
      await runOcr(paperService, paper, options);
    }
  } finally {
    pending.delete(paper.id);
    reading.delete(paper.id);
    notify();
  }
}

async function runCheck(paperService: PaperService, paper: PaperRecord, options: TextLayerQueueOptions): Promise<void> {
  const updated = await paperService.checkTextLayer(paper.id).catch(() => undefined);
  if (updated?.textLayer?.state === "failed") {
    await options.logger?.log("WARN", LOG_MODULE, "Text layer check failed", {
      paperId: paper.id,
      reason: updated.textLayer.reason,
    });
  }
}

async function runOcr(paperService: PaperService, paper: PaperRecord, options: TextLayerQueueOptions): Promise<void> {
  const progress = new LazyProgress(paper.title);
  let result: MakeSearchableResult;
  try {
    result = await paperService.makeSearchable(paper.id, {
      onProgress: (step) => {
        reading.set(paper.id, { paperId: paper.id, phase: "reading", page: step.index, total: step.total });
        notify();
        progress.report(step);
      },
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
    ...(result.status === "unavailable" || result.status === "skipped" ? { reason: result.reason } : {}),
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
    case "skipped":
      return announceAll ? `"${title}" was not read: ${result.reason}.` : undefined;
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
