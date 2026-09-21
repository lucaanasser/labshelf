/** Registers all user-facing extension commands against the VS Code command registry. @depends vscode, paperService, logger, themeManager, annotationManager. @dependents extension */
import * as vscode from "vscode";

import type { PaperService } from "../core/paperService.js";
import type { WorkspaceLogger } from "../core/logger.js";
import type { ThemeManager } from "../pdf-viewer/ThemeManager.js";
import type { AnnotationManager } from "../pdf-viewer/AnnotationManager.js";
import type { PaperDataStore } from "../storage/data/paperDataStore.js";
import type { IResearchDatabase, PaperRecord, PaperStatus, BatchImportResult } from "@labshelf/core";
import { fetchMetadataForPaper, offerMetadataFetch, resolveMissingMetadata } from "./fetchMetadata.js";
import { announceImport, importWithProgress } from "./importProgress.js";
import { queueTextLayers } from "./textLayerQueue.js";

const LOG_MODULE = "commands/registerCommands";

export type ActiveServices = {
  paperService: PaperService;
  logger: WorkspaceLogger;
  themeManager: ThemeManager;
  annotationManager: AnnotationManager;
  database: IResearchDatabase;
  paperDataStore: PaperDataStore;
};

export type RequireServices = () => Promise<ActiveServices | null>;

/** Registers all labshelf.* commands onto the extension context subscriptions. @usedBy extension. @returns void */
export function registerCommands(
  context: vscode.ExtensionContext,
  requireServices: RequireServices,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.addPaper", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.addPaper", async () => {
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: true,
          canSelectFiles: true,
          canSelectFolders: true,
          filters: { PDF: ["pdf"] },
          openLabel: "Add Paper",
        });

        if (!selected || selected.length === 0) {
          return;
        }

        await runBatchImport(services.paperService, services.logger, selected);
      });
    }),
    vscode.commands.registerCommand("labshelf.makeSearchable", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.makeSearchable", async () => {
        const paper = await pickPaper(services.paperService, "Make a scanned paper searchable (OCR)");
        if (paper) {
          await queueTextLayers(services.paperService, [paper], { logger: services.logger, announceAll: true });
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.makeLibrarySearchable", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.makeLibrarySearchable", async () => {
        // Papers that already have text are skipped in a fraction of a second each.
        const papers = await services.paperService.listPapers();
        await queueTextLayers(services.paperService, papers, { logger: services.logger });
        void vscode.window.showInformationMessage("LabShelf: finished checking the library for scanned papers.");
      });
    }),
    vscode.commands.registerCommand("labshelf.openPaper", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.openPaper", async () => {
        const paper = await pickPaper(services.paperService, "Open paper");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.searchLibrary", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.searchLibrary", async () => {
        const paper = await pickPaper(services.paperService, "Search library");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.generateBibTeX", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.generateBibTeX", async () => {
        const regeneratedCount = await services.paperService.regenerateBibTeX();
        await vscode.window.showInformationMessage(`Regenerated BibTeX for ${regeneratedCount} paper(s).`);
      });
    }),
    vscode.commands.registerCommand("labshelf.rebuildIndex", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.rebuildIndex", async () => {
        await vscode.window.showInformationMessage("Rebuild Index is wired for the next iteration.");
      });
    }),
    vscode.commands.registerCommand("labshelf.openSidebar", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.labshelfContainer");
    }),
    vscode.commands.registerCommand("labshelf.openPaperPdfExternal", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.openPaperPdfExternal", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Open paper PDF in default viewer");
        if (paper) {
          await openPaperPdfExternal(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.openPaperPdf", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.openPaperPdf", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Open paper PDF");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.openPaperFolder", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.openPaperFolder", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Reveal paper folder");
        if (paper) {
          await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(paper.path));
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.copyCitation", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.copyCitation", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Copy citation key");
        if (!paper) {
          return;
        }
        await vscode.env.clipboard.writeText(paper.citeKey);
        vscode.window.setStatusBarMessage(`LabShelf: copied @${paper.citeKey}`, 2000);
      });
    }),
    vscode.commands.registerCommand("labshelf.fetchMetadata", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.fetchMetadata", async () => {
        const paper = paperId
          ? (await services.paperService.listPapers()).find((entry) => entry.id === paperId)
          : await pickPaper(services.paperService, "Select the paper to look up");
        if (!paper) { return; }
        await fetchMetadataForPaper(services.paperService, paper);
      });
    }),
    vscode.commands.registerCommand("labshelf.resolveMissingMetadata", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.resolveMissingMetadata", async () => {
        await resolveMissingMetadata(services.paperService);
      });
    }),
    vscode.commands.registerCommand("labshelf.deletePaper", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.deletePaper", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Remove paper from library");
        if (!paper) {
          return;
        }
        const choice = await vscode.window.showWarningMessage(
          `Remove "${paper.title}" from library?`,
          { modal: true },
          "Remove only",
          "Remove + delete files",
        );
        if (!choice) {
          return;
        }
        await services.paperService.deletePaper(paper.id, choice === "Remove + delete files");
        vscode.window.setStatusBarMessage(`LabShelf: removed "${paper.title}"`, 3000);
      });
    }),
  );
}

/** Returns the paper matching paperId if given, or presents a quick-pick for the user to choose from. @usedBy extension (labshelf.openPdfViewer, labshelf.exportAnnotations). @returns the paper, or undefined when cancelled or the library is empty */
export async function resolvePaper(
  paperService: PaperService,
  paperId: string | undefined,
  placeholder: string,
): Promise<PaperRecord | undefined> {
  const papers = await paperService.listPapers();
  if (papers.length === 0) {
    await vscode.window.showInformationMessage("LabShelf library is empty.");
    return undefined;
  }

  if (paperId) {
    const direct = papers.find((paper) => paper.id === paperId);
    if (direct) {
      return direct;
    }
  }

  return pickFrom(papers, placeholder);
}

// Lists all papers and presents a quick-pick with the given placeholder label.
async function pickPaper(paperService: PaperService, placeholder: string): Promise<PaperRecord | undefined> {
  const papers = await paperService.listPapers();
  if (papers.length === 0) {
    await vscode.window.showInformationMessage("LabShelf library is empty.");
    return undefined;
  }
  return pickFrom(papers, placeholder);
}

// Shows a VS Code quick-pick populated with all papers and returns the selected one.
async function pickFrom(papers: PaperRecord[], placeholder: string): Promise<PaperRecord | undefined> {
  const items = papers.map((paper) => ({
    label: paper.title,
    description: `@${paper.citeKey}`,
    detail: `${formatStatus(paper.status)}${paper.year ? ` · ${paper.year}` : ""}`,
    paper,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: placeholder, matchOnDescription: true });
  return picked?.paper;
}

// Capitalizes the first letter of a paper status string for display.
function formatStatus(status: PaperStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Opens the paper in the LabShelf reader.
async function openPaperPdf(paper: PaperRecord): Promise<void> {
  await vscode.commands.executeCommand("labshelf.openPdfViewer", paper.id);
}

// Escape hatch: hands paper.pdf to VS Code's default handler (or the OS viewer) instead of the LabShelf reader.
async function openPaperPdfExternal(paper: PaperRecord): Promise<void> {
  const pdf = vscode.Uri.joinPath(vscode.Uri.file(paper.path), "paper.pdf");
  await vscode.commands.executeCommand("vscode.open", pdf);
}

// Runs a batch import for the given URIs with a notification progress indicator, logging and surfacing any failures.
async function runBatchImport(
  paperService: PaperService,
  logger: WorkspaceLogger,
  uris: vscode.Uri[],
): Promise<void> {
  const result = await importWithProgress(paperService, uris, undefined, logger);

  if (result.failed.length > 0) {
    await logger.log("WARN", LOG_MODULE, "Batch import had failures", {
      failed: result.failed,
    });
    vscode.window.showWarningMessage(`LabShelf: ${buildResultMessage(result)}`);
  } else {
    announceImport(result);
  }

  await offerMetadataFetch(paperService, result.needsReview ?? []);
}

// Builds a human-readable summary string from a BatchImportResult (e.g. "3 papers imported, 1 failed").
function buildResultMessage(result: BatchImportResult): string {
  const parts: string[] = [];
  if (result.success.length > 0) {
    parts.push(`${result.success.length} paper${result.success.length === 1 ? "" : "s"} imported`);
  }
  if (result.failed.length > 0) {
    parts.push(`${result.failed.length} failed`);
  }
  if (result.skipped.length > 0) {
    parts.push(`${result.skipped.length} skipped`);
  }
  return parts.join(", ") || "Nothing to import";
}

// Wraps an async command action with error logging and a user-facing error message on failure.
async function executeSafely(logger: WorkspaceLogger, commandName: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    await logger.error(LOG_MODULE, error, { commandName });
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`LabShelf command failed: ${message}`);
  }
}

