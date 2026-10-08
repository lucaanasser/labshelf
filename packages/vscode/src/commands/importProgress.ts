/**
 * Runs every way of adding papers (command, sidebar drop, "Add here") with visible progress and one summary: reading a
 * PDF, running OCR and asking the registries can take ten seconds or more per file, indistinguishable from a hang.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { summarizeImport } from "@labshelf/core";
import type { ILogger, ImportOutcome, ImportProgress } from "@labshelf/core";
import type { PaperImporter, PaperService, PaperTextLayers } from "../core/index.js";
import { offerMetadataFetch } from "./fetchMetadata.js";
import { queueTextLayers } from "./textLayerQueue.js";

const LIBRARY_VIEW_ID = "labshelf.library";

export interface ImportServices {
  importer: PaperImporter;
  textLayers: PaperTextLayers;
  paperService: PaperService;
  logger: ILogger;
}

/**
 * Imports the picked files and folders into targetDir (papers/ when absent), announces the outcome and offers a
 * metadata lookup for papers no registry confirmed.
 * @returns the outcome of each input
 */
export async function importPapers(
  services: ImportServices,
  uris: vscode.Uri[],
  targetDir?: string,
): Promise<ImportOutcome[]> {
  const outcomes = await importWithProgress(services, uris, targetDir);
  announceImport(outcomes);
  const unconfirmed = outcomes.flatMap((outcome) => (outcome.status === "added" && outcome.needsReview ? [outcome.record] : []));
  await offerMetadataFetch(services.paperService, unconfirmed);
  return outcomes;
}

/**
 * Imports while a notification names the file in progress, plus the library view's own progress bar, since the
 * sidebar is where the user looks for the paper to appear.
 * @returns the outcome of each input
 */
export async function importWithProgress(
  services: Pick<ImportServices, "importer" | "textLayers" | "logger">,
  uris: vscode.Uri[],
  targetDir?: string,
): Promise<ImportOutcome[]> {
  const outcomes = await runImport(services.importer, uris, targetDir);
  // Scanned papers gain their text layer after they appear: reading every page can take a minute, too long to hold an
  // import. With automatic OCR off they are still checked, so the list can flag them.
  const autoOcr = vscode.workspace.getConfiguration("labshelf").get<boolean>("ocr.makeSearchable", true);
  const added = outcomes.flatMap((outcome) => (outcome.status === "added" ? [outcome.record] : []));
  void queueTextLayers(services.textLayers, added, { logger: services.logger, mode: autoOcr ? "ocr" : "check" });
  return outcomes;
}

function runImport(importer: PaperImporter, uris: vscode.Uri[], targetDir?: string): Thenable<ImportOutcome[]> {
  return vscode.window.withProgress({ location: { viewId: LIBRARY_VIEW_ID } }, () =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "LabShelf", cancellable: false },
      (progress) => {
        progress.report({ message: "Preparing import…" });
        return importer.importPaths(uris.map((uri) => uri.fsPath), targetDir, (step) => {
          // No increment for the first file: reporting one, even zero, turns the spinner into a bar stuck at 0% for
          // the whole of a single import.
          progress.report({
            message: describeStep(step),
            ...(step.index > 1 ? { increment: 100 / step.total } : {}),
          });
        });
      },
    ),
  );
}

/** Shows the one import summary every app words the same way. */
export function announceImport(outcomes: ImportOutcome[]): void {
  const summary = summarizeImport(outcomes);
  const show = summary.level === "warn" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  void show(`LabShelf: ${summary.text}`);
}

/** @returns the progress line for one step, e.g. `Importing 2 of 5: "paper.pdf" — reading and identifying…` */
export function describeStep(step: ImportProgress): string {
  const counter = step.total > 1 ? ` ${step.index} of ${step.total}` : "";
  return `Importing${counter}: "${path.basename(step.input)}" — reading and identifying the paper…`;
}
