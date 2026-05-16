/**
 * Module: Extension Entry Point
 * Responsibility: Wire services, commands, library folder tree, and list panel
 * Dependencies: vscode, core, storage, db, ui
 *
 * Initialization strategy:
 *   1. Always activate — no workspace folder required.
 *   2. If a library root is already configured in globalState, initialize all services immediately.
 *   3. If not, services remain null; the first write command triggers the setup wizard.
 *   4. After wizard completion, services are initialized and the tree is refreshed.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { ExtensionEventBus } from "./core/eventBus.js";
import { PaperService } from "./core/paperService.js";
import { WorkspaceLogger } from "./core/logger.js";
import { InMemoryResearchDatabase } from "./db/database.js";
import { FileSystemService } from "./storage/fileSystemService.js";
import { LibraryPaths } from "./storage/paths/libraryPaths.js";
import {
  resolveLibraryRoot,
  runLibrarySetupWizard,
  ensureLibraryStructure,
} from "./storage/paths/libraryLocation.js";
import { LibraryTreeDataProvider, LibraryDragAndDropController } from "./ui/libraryTreeDataProvider.js";
import type { LibraryNode } from "./ui/libraryTreeDataProvider.js";
import { SyncTreeDataProvider } from "./ui/syncTreeDataProvider.js";
import { ListWebviewPanel } from "./ui/listWebviewPanel.js";
import { PdfViewerPanel } from "./pdf-viewer/PdfViewerPanel.js";
import { registerCommands } from "./commands/registerCommands.js";
import type { ActiveServices } from "./commands/registerCommands.js";
import { PdfImportParser } from "./pdf/pdfImportParser.js";
import { BibTeXService } from "./bibtex/bibtexService.js";
import { ThemeManager } from "./pdf-viewer/ThemeManager.js";
import { AnnotationManager } from "./pdf-viewer/AnnotationManager.js";
import { PaperDataStore } from "./storage/data/paperDataStore.js";
import { LibraryIndexer } from "./storage/data/libraryIndexer.js";
import { migrateSidecarsFromDb } from "./storage/data/migrateSidecars.js";
import { SyncController } from "./sync/adapter/syncController.js";
import type { ResearchDatabase } from "./db/database.js";
import type { PaperRecord } from "./core/types.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const fileSystemService = new FileSystemService();
  const eventBus = new ExtensionEventBus();

  let activeServices: ActiveServices | null = null;
  let syncController: SyncController | null = null;
  let libraryRoot: vscode.Uri | undefined = await resolveLibraryRoot(context);

  const papersRootUri = (): vscode.Uri | null =>
    libraryRoot ? new LibraryPaths(libraryRoot).papersRoot() : null;

  if (libraryRoot) {
    activeServices = await buildServices(context, libraryRoot, fileSystemService, eventBus);
    syncController = new SyncController(
      context,
      new LibraryPaths(libraryRoot),
      eventBus,
      async () => {
        const papers = await activeServices!.paperService.listPapers();
        return new Map(papers.map(p => [p.id, p.title]));
      },
    );
    await syncController.initialize();
    context.subscriptions.push(syncController);
  } else {
    // Library not configured — inform user without blocking activation
    vscode.window.showInformationMessage(
      'LabShelf: No library configured. Run "Configure Library" to get started.',
      "Configure Library",
    ).then((choice) => {
      if (choice === "Configure Library") {
        vscode.commands.executeCommand("labshelf.configureLibrary");
      }
    });
  }

  // Library folder tree — mirrors the real directory structure under papers/
  const libraryProvider = new LibraryTreeDataProvider(papersRootUri(), eventBus);

  // Returns current services or triggers setup wizard, then returns newly built services.
  async function requireServices(): Promise<ActiveServices | null> {
    if (activeServices) {
      return activeServices;
    }

    const root = await runLibrarySetupWizard(context, fileSystemService);
    if (!root) {
      return null;
    }

    libraryRoot = root;
    activeServices = await buildServices(context, root, fileSystemService, eventBus);
    libraryProvider.setPapersRoot(new LibraryPaths(root).papersRoot());
    if (!syncController) {
      syncController = new SyncController(
        context,
        new LibraryPaths(root),
        eventBus,
        async () => {
          const papers = await activeServices!.paperService.listPapers();
          return new Map(papers.map(p => [p.id, p.title]));
        },
      );
      await syncController.initialize();
      context.subscriptions.push(syncController);
    }

    return activeServices;
  }

  const libraryDnD = new LibraryDragAndDropController(async (uris, targetDir) => {
    const services = await requireServices();
    if (!services) { return; }
    const target = targetDir ? vscode.Uri.file(targetDir) : undefined;
    const result = await services.paperService.addPapersFromUris(uris, target);
    if (result.failed.length > 0) {
      await services.logger.log("WARN", "extension", "Sidebar drop import had failures", { failed: result.failed });
      const firstError = result.failed[0]?.error ?? "unknown error";
      vscode.window.showErrorMessage(
        `LabShelf: ${result.success.length} imported, ${result.failed.length} failed — ${firstError}`,
      );
    } else if (result.success.length > 0) {
      vscode.window.setStatusBarMessage(`LabShelf: ${result.success.length} paper(s) imported`, 3000);
    }
  });

  context.subscriptions.push(
    vscode.window.createTreeView("labshelf.library", {
      treeDataProvider: libraryProvider,
      dragAndDropController: libraryDnD,
      showCollapseAll: true,
    }),
  );

  // Google Drive sync panel — shows status and action items.
  if (syncController) {
    const syncTree = new SyncTreeDataProvider(syncController);
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider("labshelf.activity", syncTree),
      syncTree,
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openListTab", (node?: LibraryNode) => {
      requireServices().then((services) => {
        if (services) {
          ListWebviewPanel.createOrShow(context.extensionUri, services.paperService, eventBus, node);
        }
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openPdfViewer", (paperId?: string) => {
      requireServices().then(async (services) => {
        if (!services) { return; }
        let paper: PaperRecord | undefined;
        if (paperId) {
          const papers = await services.paperService.listPapers();
          paper = papers.find(p => p.id === paperId);
        }
        PdfViewerPanel.createOrShow(
          context.extensionUri,
          services.paperService,
          eventBus,
          services.themeManager,
          services.annotationManager,
          paper,
        );
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.library.refresh", () => libraryProvider.refresh()),
  );

  // Create a folder — under the clicked folder (context menu) or at the library root (title bar).
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.newFolder", async (node?: LibraryNode) => {
      if (!(await requireServices())) { return; }
      const parent = node ? vscode.Uri.file(node.dirPath) : papersRootUri();
      if (!parent) { return; }

      const name = await vscode.window.showInputBox({
        prompt: "Folder name",
        placeHolder: "My Folder",
        validateInput: (value) => isValidFolderName(value) ? null : "Use a name without slashes.",
      });
      if (!name?.trim()) { return; }

      await fileSystemService.ensureDirectory(vscode.Uri.joinPath(parent, name.trim()));
      libraryProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.renameFolder", async (node?: LibraryNode) => {
      if (!node) { return; }
      const services = await requireServices();
      if (!services) { return; }

      const name = await vscode.window.showInputBox({
        prompt: "New folder name",
        value: node.label,
        validateInput: (value) => isValidFolderName(value) ? null : "Use a name without slashes.",
      });
      if (!name?.trim() || name.trim() === node.label) { return; }

      const target = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(node.dirPath)), name.trim());
      await vscode.workspace.fs.rename(vscode.Uri.file(node.dirPath), target, { overwrite: false });
      await services.paperService.relocatePapersUnder(node.dirPath, target.fsPath);
      libraryProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.deleteFolder", async (node?: LibraryNode) => {
      if (!node) { return; }
      const services = await requireServices();
      if (!services) { return; }

      const choice = await vscode.window.showWarningMessage(
        `Delete folder "${node.label}" and everything inside it?`,
        { modal: true },
        "Delete",
      );
      if (choice !== "Delete") { return; }

      await services.paperService.removePapersUnder(node.dirPath);
      await vscode.workspace.fs.delete(vscode.Uri.file(node.dirPath), { recursive: true, useTrash: true });
      libraryProvider.refresh();
    }),
  );

  // Import papers into a specific folder via its context menu.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.addPaperHere", async (node?: LibraryNode) => {
      const services = await requireServices();
      if (!services) { return; }

      const selected = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: true,
        filters: { PDF: ["pdf"] },
        openLabel: "Add Paper",
      });
      if (!selected || selected.length === 0) { return; }

      const target = node ? vscode.Uri.file(node.dirPath) : undefined;
      const result = await services.paperService.addPapersFromUris(selected, target);
      if (result.failed.length > 0) {
        await services.logger.log("WARN", "extension", "Add Paper Here had failures", { failed: result.failed });
        const firstError = result.failed[0]?.error ?? "unknown error";
        vscode.window.showErrorMessage(
          `LabShelf: ${result.success.length} imported, ${result.failed.length} failed — ${firstError}`,
        );
      } else if (result.success.length > 0) {
        vscode.window.setStatusBarMessage(`LabShelf: ${result.success.length} paper(s) imported`, 3000);
      }
    }),
  );

  // Configure / reconfigure the library root
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.configureLibrary", async () => {
      const root = await runLibrarySetupWizard(context, fileSystemService);
      if (!root) { return; }

      libraryRoot = root;
      activeServices = await buildServices(context, root, fileSystemService, eventBus);
      libraryProvider.setPapersRoot(new LibraryPaths(root).papersRoot());
      vscode.window.showInformationMessage(`LabShelf: Library configured at ${root.fsPath}`);
    }),
  );

  // Sync commands — require the library to be configured first
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.sync.connect", async () => {
      if (!(await requireServices())) { return; }
      await syncController?.connect();
    }),
    vscode.commands.registerCommand("labshelf.sync.now", async () => {
      if (!(await requireServices())) { return; }
      await syncController?.sync();
    }),
    vscode.commands.registerCommand("labshelf.sync.disconnect", async () => {
      await syncController?.disconnect();
    }),
  );

  registerCommands(context, requireServices);

  if (activeServices) {
    const services = activeServices;
    eventBus.on("paper:added", async (payload) => {
      await services.logger.log("INFO", "core/paperService", "Paper added", { payload });
    });
    eventBus.on("paper:updated", async (payload) => {
      await services.logger.log("INFO", "core/paperService", "Paper updated", { payload });
    });
  }
}

export function deactivate(): void {
  return;
}

function isValidFolderName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/[/\\]/.test(trimmed);
}

async function buildServices(
  context: vscode.ExtensionContext,
  root: vscode.Uri,
  fileSystemService: FileSystemService,
  eventBus: ExtensionEventBus,
): Promise<ActiveServices> {
  const paths = new LibraryPaths(root);
  await ensureLibraryStructure(root, fileSystemService);
  const database = await initializeDatabase(paths.indexPath(), fileSystemService);
  const logger = new WorkspaceLogger(fileSystemService, paths, {
    append: async (entry) => database.appendLog(entry),
  });
  const pdfImportParser = new PdfImportParser();
  const bibTeXService = new BibTeXService(fileSystemService);
  const paperService = new PaperService(fileSystemService, database, eventBus, paths, pdfImportParser, bibTeXService);
  const paperDataStore = new PaperDataStore(paths.researchRoot(), fileSystemService);
  const indexer = new LibraryIndexer(paths, fileSystemService, database, paperDataStore);
  await migrateSidecarsFromDb(database, paperDataStore, await database.listPapers());
  await indexer.rebuild();
  const themeManager = new ThemeManager(paperDataStore);
  const annotationManager = new AnnotationManager(paperDataStore, eventBus);
  return { paperService, logger, themeManager, annotationManager };
}

async function initializeDatabase(indexPath: vscode.Uri, fileSystemService: FileSystemService): Promise<ResearchDatabase> {
  try {
    const { createSqliteResearchDatabase } = await import("./db/sqliteResearchDatabase.js");
    const database = await createSqliteResearchDatabase(indexPath, fileSystemService);
    await database.initialize();
    return database;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`LabShelf SQLite unavailable, using in-memory fallback: ${message}`);
    const fallback = new InMemoryResearchDatabase();
    await fallback.initialize();
    return fallback;
  }
}
