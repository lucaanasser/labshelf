/**
 * Visual feedback for paper imports, shared by every way of adding a paper
 * (command, sidebar drop, "Add here"). Reading a PDF, running OCR and asking
 * the registries can take ten seconds or more per file; without feedback that
 * is indistinguishable from a hang.
 */
import * as vscode from "vscode";

import type { BatchImportResult, ILogger } from "@labshelf/core";
import type { ImportProgress, PaperService } from "../core/paperService.js";
import { queueTextLayers } from "./textLayerQueue.js";

const LIBRARY_VIEW_ID = "labshelf.library";

/**
 * Imports the given PDFs while showing a notification that names the file in
 * progress, plus the library view's own progress bar, since the sidebar is
 * where the user is looking for the paper to appear.
 * @returns the BatchImportResult of the import
 */
export async function importWithProgress(
  paperService: PaperService,
  uris: vscode.Uri[],
  targetParentDir?: vscode.Uri,
  logger?: ILogger,
): Promise<BatchImportResult> {
  const result = await runImport(paperService, uris, targetParentDir);
  // Scanned papers gain their text layer after they appear in the library:
  // reading every page can take a minute, which is too long to hold an import.
  // With automatic OCR off they are still checked, so the list can flag them.
  const autoOcr = vscode.workspace.getConfiguration("labshelf").get<boolean>("ocr.makeSearchable", true);
  void queueTextLayers(paperService, result.success, { logger, mode: autoOcr ? "ocr" : "check" });
  return result;
}

function runImport(
  paperService: PaperService,
  uris: vscode.Uri[],
  targetParentDir?: vscode.Uri,
): Thenable<BatchImportResult> {
  return vscode.window.withProgress({ location: { viewId: LIBRARY_VIEW_ID } }, () =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "LabShelf", cancellable: false },
      (progress) => {
        progress.report({ message: "Preparing import…" });
        return paperService.addPapersFromUris(uris, targetParentDir, (step) => {
          // No increment for the first file: reporting one, even zero, turns the
          // spinner into a bar stuck at 0% for the whole of a single import.
          progress.report({
            message: describeStep(step),
            ...(step.index > 1 ? { increment: 100 / step.total } : {}),
          });
        });
      },
    ),
  );
}

/**
 * Confirms a finished import by naming what was added: the extracted title is
 * the proof that the paper was recognised, not merely copied.
 * @returns void
 */
export function announceImport(result: BatchImportResult): void {
  const message = describeResult(result);
  if (message) {
    void vscode.window.showInformationMessage(`LabShelf: ${message}`);
  }
}

/**
 * Builds the progress line for one step of the import.
 * @returns e.g. `Importing 2 of 5: "paper.pdf" — reading and identifying…`
 */
export function describeStep(step: ImportProgress): string {
  const counter = step.total > 1 ? ` ${step.index} of ${step.total}` : "";
  return `Importing${counter}: "${step.fileName}" — reading and identifying the paper…`;
}

/**
 * Builds the confirmation text for a finished import.
 * @returns the message, or undefined when nothing was imported
 */
export function describeResult(result: BatchImportResult): string | undefined {
  const count = result.success.length;
  if (count === 0) {
    return undefined;
  }
  const review = result.needsReview?.length ?? 0;
  const reviewNote = review > 0 ? ` (${review} could not be identified and need${review === 1 ? "s" : ""} review)` : "";
  if (count === 1) {
    return `Added "${result.success[0]!.title}"${reviewNote}`;
  }
  return `${count} papers imported${reviewNote}`;
}
