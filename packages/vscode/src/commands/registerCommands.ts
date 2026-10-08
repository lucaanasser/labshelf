/** Registers all user-facing extension commands against the VS Code command registry */
import * as vscode from "vscode";

import type { PaperImporter, PaperService, PaperTextLayers } from "../core/index.js";
import type { ThemeManager } from "../pdf-viewer/ThemeManager.js";
import type { AnnotationManager } from "../pdf-viewer/AnnotationManager.js";
import type { PaperDataStore } from "../storage/data/paperDataStore.js";
import { type IFileSystem, type ILogger, type IResearchDatabase, type LocalFileSystem, type PaperRecord, type MutationContext, type PaperStatus, isSafeExternalUrl, paperFiles } from "@labshelf/core";
import { fetchMetadataForPaper, resolveMissingMetadata } from "./fetchMetadata.js";
import { importPapers } from "./importProgress.js";
import { removePapers } from "./removePapers.js";
import { queueTextLayers } from "./textLayerQueue.js";
import type { ReindexSummary } from "../storage/data/reindexLibrary.js";

const LOG_MODULE = "commands/registerCommands";

export type ActiveServices = {
  paperService: PaperService;
  importer: PaperImporter;
  textLayers: PaperTextLayers;
  // The ports every core library mutation runs over, for this library root.
  mutations: MutationContext;
  logger: ILogger;
  themeManager: ThemeManager;
  annotationManager: AnnotationManager;
  database: IResearchDatabase;
  paperDataStore: PaperDataStore;
  // The adapter of this library root; its temp folder for atomic writes is inside the root.
  fileSystem: IFileSystem & LocalFileSystem;
  // Rebuilds the index from disk and emits the resulting paper events. Bound in
  // extension.ts over the live database, indexer and event bus.
  reindexLibrary: () => Promise<ReindexSummary>;
};

export type RequireServices = () => Promise<ActiveServices | null>;

/** Registers all labshelf.* commands onto the extension context subscriptions */
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

        await importPapers(services, selected);
      });
    }),
    // Called with paper ids from the list panel, or with nothing from the palette.
    vscode.commands.registerCommand("labshelf.makeSearchable", async (target?: string | string[]) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.makeSearchable", async () => {
        const papers = target !== undefined
          ? await papersByIds(services.paperService, Array.isArray(target) ? target : [target])
          : [await pickPaper(services.paperService, "Make a scanned paper searchable (OCR)")].filter(isPaper);
        if (papers.length > 0) {
          await queueTextLayers(services.textLayers, papers, { logger: services.logger, announceAll: true });
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.makeLibrarySearchable", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.makeLibrarySearchable", async () => {
        // Papers that already have text are skipped in a fraction of a second
        // each; papers saved without a PDF have nothing to read and are left out.
        const papers = (await services.paperService.listPapers()).filter((p) => p.hasPdf !== false);
        await queueTextLayers(services.textLayers, papers, { logger: services.logger });
        const checked = await services.paperService.listPapers();
        void vscode.window.showInformationMessage(`LabShelf: ${describeLibraryTextLayers(checked)}`);
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
        const summary = await services.reindexLibrary();
        const changed = summary.added.length + summary.updated.length;
        void vscode.window.showInformationMessage(
          changed > 0
            ? `LabShelf: index rebuilt — ${summary.added.length} added, ${summary.updated.length} updated.`
            : "LabShelf: index rebuilt; nothing changed.",
        );
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
        if (paper && await ensurePaperPdf(services, paper)) {
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
        await removePapers(services.paperService, [paper]);
      });
    }),
  );
}

/**
 * Guards every "open the PDF" entry point. When the paper has no paper.pdf it
 * reconciles the possibly stale flag, warns the user immediately (the VS Code
 * form of the "instant popup" asked for), offers the article page when a DOI or
 * URL is known, and returns false so the caller opens nothing.
 * @returns true when the PDF is present and the reader may open
 */
export async function ensurePaperPdf(services: ActiveServices, paper: PaperRecord): Promise<boolean> {
  const reconciled = await services.paperService.reconcilePdf(paper.id);
  const current = reconciled?.paper ?? paper;
  const hasPdf = reconciled ? reconciled.hasPdf : paper.hasPdf !== false;
  if (hasPdf) {
    return true;
  }
  await services.logger.log("INFO", LOG_MODULE, "Paper has no PDF; reader not opened", { paperId: current.id });
  const link = articleLink(current);
  const choice = await vscode.window.showWarningMessage(
    `LabShelf: "${current.title}" has no PDF yet.`,
    ...(link ? ["Open Link"] : []),
  );
  if (choice === "Open Link" && link) {
    await vscode.env.openExternal(vscode.Uri.parse(link));
  }
  return false;
}

// The article's own page: its DOI resolver first, else a stored http(s) URL.
// Only safe web schemes are offered, so a hand-edited record cannot smuggle a
// file: or command: link into an openExternal call.
function articleLink(paper: PaperRecord): string | undefined {
  const candidate = paper.doi ? `https://doi.org/${paper.doi}` : paper.url;
  return candidate && isSafeExternalUrl(candidate) ? candidate : undefined;
}

/** Returns the paper matching paperId if given, or presents a quick-pick for the user to choose from */
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

// Resolves ids from a webview message to papers, dropping any that no longer exist.
async function papersByIds(paperService: PaperService, ids: string[]): Promise<PaperRecord[]> {
  const wanted = new Set(ids);
  return (await paperService.listPapers()).filter((paper) => wanted.has(paper.id));
}

function isPaper(value: PaperRecord | undefined): value is PaperRecord {
  return value !== undefined;
}

/**
 * Summarizes the text layers across the library after a library-wide pass.
 * @returns e.g. "Library checked: 12 with text, 2 made searchable by OCR, 1 without text."
 */
export function describeLibraryTextLayers(papers: PaperRecord[]): string {
  const count = (state: string): number => papers.filter((paper) => paper.textLayer?.state === state).length;
  const parts = [`${count("native")} with text`];
  if (count("ocr") > 0) { parts.push(`${count("ocr")} made searchable by OCR`); }
  const without = count("missing") + count("failed");
  if (without > 0) { parts.push(`${without} without text (see the "No text" filter)`); }
  return `Library checked: ${parts.join(", ")}.`;
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
  const pdf = paperFiles(vscode.Uri.file(paper.path), vscode.Uri.joinPath).pdf;
  await vscode.commands.executeCommand("vscode.open", pdf);
}

// Wraps an async command action with error logging and a user-facing error message on failure.
async function executeSafely(logger: ILogger, commandName: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    await logger.error(LOG_MODULE, error, { commandName });
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`LabShelf command failed: ${message}`);
  }
}

