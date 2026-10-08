/** Extension entry point — wires services, commands, library folder tree, sync controller, and list panel on activation */
import * as path from "node:path";
import * as vscode from "vscode";

import {
  EventBus,
  InMemoryResearchDatabase,
  PdfImportParser,
  BibTeXService,
  libraryLayout,
  paperFiles,
  type IFileSystem,
  type ILogger,
  type IResearchDatabase,
  type MutationContext,
  type SyncResult,
  type ReaderCommandId,
} from "@labshelf/core";
import { PaperImporter, PaperService, PaperTextLayers, createExtensionLogger } from "./core/index.js";
import { VscodeFileSystem } from "./storage/vscodeFileSystem.js";
import {
  resolveLibraryRoot,
  runLibrarySetupWizard,
  ensureLibraryStructure,
  mirrorLibraryRoot,
} from "./storage/paths/index.js";
import { ExternalChangeWatcher, findMissingPapers } from "./storage/data/externalChangeWatcher.js";
import { LibraryTreeDataProvider, LibraryDragAndDropController } from "./ui/library/index.js";
import type { LibraryNode } from "./ui/library/index.js";
import { ListWebviewPanel } from "./ui/list/index.js";
import { SettingsWebviewPanel } from "./ui/settings/index.js";
import { PdfViewerPanel } from "./pdf-viewer/PdfViewerPanel.js";
import { registerCommands, resolvePaper, ensurePaperPdf } from "./commands/registerCommands.js";
import { registerAiCommands } from "./commands/registerAiCommands.js";
import { importPapers } from "./commands/importProgress.js";
import { moveFolders, registerFolderCommands, type FolderCommandHost } from "./commands/folderCommands.js";
import type { ActiveServices } from "./commands/registerCommands.js";
import { createAiService, AiService } from "./ai/service/index.js";
import { SqliteResearchDatabase } from "./db/sqliteResearchDatabase.js";
import { NodePdfOpener } from "./pdf/nodePdfOpener.js";
import { TesseractOcrEngine } from "./pdf/tesseractOcrEngine.js";
import { SearchablePdfBuilder } from "./pdf/searchablePdfBuilder.js";
import { currentTextLayerJobs, onTextLayerJobsChanged, queueTextLayers } from "./commands/textLayerQueue.js";
import { ThemeManager } from "./pdf-viewer/ThemeManager.js";
import { AnnotationManager } from "./pdf-viewer/AnnotationManager.js";
import { PaperDataStore } from "./storage/data/paperDataStore.js";
import { LibraryIndexer } from "./storage/data/libraryIndexer.js";
import { reindexLibrary } from "./storage/data/reindexLibrary.js";
import { SyncController } from "./sync/adapter/syncController.js";
import { findSimilarPapers } from "./ai/service/similarPapers.js";

// The adapter belongs to one library root: its temp folder for atomic writes sits inside that root.
const createFileSystem = (root: vscode.Uri): VscodeFileSystem =>
  new VscodeFileSystem(libraryLayout(root, vscode.Uri.joinPath).tmpDir().fsPath);

const READER_COMMANDS: readonly ReaderCommandId[] = [
  "zoomIn", "zoomOut", "zoomReset", "find", "historyBack", "historyForward", "toggleSidebar",
];

/** Activates the extension, initializing services if a library is already configured */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const eventBus = new EventBus();

  let activeServices: ActiveServices | null = null;
  let syncController: SyncController | null = null;
  let aiService: AiService | null = null;
  let libraryRoot: vscode.Uri | undefined = await resolveLibraryRoot(context);

  const papersRootUri = (): vscode.Uri | null =>
    libraryRoot ? libraryLayout(libraryRoot, vscode.Uri.joinPath).papersRoot() : null;

  // Declared before the first await: ensureSyncController runs inside the progress callback and reaches it.
  let externalWatcher: ExternalChangeWatcher | undefined;

  if (libraryRoot) {
    // The Library tree is only registered once the index is open. Until then the view shows
    // "Loading your library…" (package.json viewsWelcome, keyed on labshelf.libraryLoaded) under
    // VS Code's own progress bar, never "No folders yet", which would read as a lost library.
    const root = libraryRoot;
    activeServices = await vscode.window.withProgress({ location: { viewId: "labshelf.library" } }, async () => {
      const services = await buildServices(context, root, eventBus);
      activeServices = services;
      aiService = await maybeStartAi(context, eventBus, services);
      await ensureSyncController(root, services);
      return services;
    });
  } else {
    // Library not configured — inform the user without blocking activation.
    vscode.window.showInformationMessage(
      'LabShelf: No library configured. Run "Configure Library" to get started.',
      "Configure Library",
    ).then((choice) => {
      if (choice === "Configure Library") {
        vscode.commands.executeCommand("labshelf.configureLibrary");
      }
    });
  }

  // Library folder tree mirrors the real directory structure under papers/.
  const libraryProvider = new LibraryTreeDataProvider(papersRootUri(), eventBus);

  // Returns current services or triggers the setup wizard and builds services from the chosen root.
  async function requireServices(): Promise<ActiveServices | null> {
    if (activeServices) {
      return activeServices;
    }

    const root = await runLibrarySetupWizard(context, createFileSystem);
    if (!root) {
      return null;
    }

    libraryRoot = root;
    activeServices = await buildServices(context, root, eventBus);
    libraryProvider.setPapersRoot(libraryLayout(root, vscode.Uri.joinPath).papersRoot());
    await ensureSyncController(root, activeServices);

    return activeServices;
  }

  // Creates the sync controller once, wiring the post-sync re-index. A sync that
  // pulls files from Drive must surface in the list without a reload, so the
  // controller's onDidSync triggers reindexLibrary (edits 8-9).
  async function ensureSyncController(root: vscode.Uri, services: ActiveServices): Promise<void> {
    const fileSystem = services.fileSystem;
    // Every path that activates a library root comes through here, so the watcher and the shared config follow it.
    watchLibrary(root);
    void mirrorLibraryRoot(root, services.logger);
    if (syncController) {
      syncController.setLibrary(libraryLayout(root, vscode.Uri.joinPath), fileSystem);
      return;
    }
    const controller = new SyncController(
      context,
      libraryLayout(root, vscode.Uri.joinPath),
      fileSystem,
      eventBus,
      async () => {
        const papers = await activeServices!.paperService.listPapers();
        return new Map(papers.map((p) => [p.id, p.title]));
      },
    );
    controller.onDidSync((result) => { void onLibrarySynced(result); });
    await controller.initialize();
    context.subscriptions.push(controller);
    syncController = controller;
  }

  // Re-indexes from disk after a sync that changed the library namespace, then
  // refreshes the views. The list panel, tree and AI indexer update through the
  // paper events reindexLibrary emits.
  async function onLibrarySynced(result: SyncResult): Promise<void> {
    if (!activeServices || !syncChangedLibrary(result)) { return; }
    try {
      await activeServices.reindexLibrary();
    } catch (error) {
      await activeServices.logger.log("WARN", "extension", "Re-index after sync failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    refreshLibraryViews();
  }

  // Changes made outside this window (the LabShelf terminal app, a sync it ran, another window) are picked up from
  // disk: re-index, drop papers whose folder is gone, and refresh the views.
  function watchLibrary(root: vscode.Uri): void {
    externalWatcher?.dispose();
    externalWatcher = new ExternalChangeWatcher(libraryLayout(root, vscode.Uri.joinPath), () => { void onExternalChange(); });
    context.subscriptions.push(externalWatcher);
  }

  async function onExternalChange(): Promise<void> {
    if (!activeServices) { return; }
    const services = activeServices;
    try {
      await services.reindexLibrary();
      const missing = await findMissingPapers(await services.paperService.listPapers(), async (folder) => {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(paperFiles(folder, path.join).metadata));
          return true;
        } catch {
          return false;
        }
      });
      for (const id of missing) { await services.paperService.removeFromIndex(id); }
    } catch (error) {
      await services.logger.log("WARN", "extension", "Re-index after an external change failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    refreshLibraryViews();
  }

  const folderHost: FolderCommandHost = {
    requireServices,
    papersRoot: () => papersRootUri()?.fsPath ?? null,
    refreshViews: () => refreshLibraryViews(),
    followFolderMove: async (from, to) => { await ListWebviewPanel.currentPanel?.followFolderMove(from, to); },
  };

  const libraryDnD = new LibraryDragAndDropController(async (uris, targetDir) => {
    const services = await requireServices();
    if (services) { await importPapers(services, uris, targetDir); }
  }, (sourceDirs, targetDir) => moveFolders(folderHost, sourceDirs, targetDir));

  libraryProvider.setPaperPathSource(async () =>
    activeServices ? (await activeServices.paperService.listPapers()).map((p) => p.path) : [],
  );

  const libraryTreeView = vscode.window.createTreeView("labshelf.library", {
    treeDataProvider: libraryProvider,
    dragAndDropController: libraryDnD,
    showCollapseAll: true,
  });
  context.subscriptions.push(libraryTreeView);
  // From here an empty Library view really is empty: switch its welcome text from loading to "No folders yet".
  void vscode.commands.executeCommand("setContext", "labshelf.libraryLoaded", true);

  // Keeps the tree selection on the folder the list panel shows. reveal() would
  // force the sidebar open, so a hidden tree is synced when it becomes visible instead.
  const syncTreeToPanel = (folder?: LibraryNode): void => {
    if (!folder || !libraryTreeView.visible) { return; }
    libraryTreeView.reveal(folder, { select: true, focus: false, expand: true }).then(undefined, () => {
      // The folder may have just been removed; a stale selection is harmless.
    });
  };
  context.subscriptions.push(
    libraryTreeView.onDidChangeVisibility((e) => {
      if (e.visible) { syncTreeToPanel(ListWebviewPanel.currentPanel?.currentFolder); }
    }),
  );

  // Folder structure changed on disk: refresh both the tree and the open panel.
  const refreshLibraryViews = (): void => {
    libraryProvider.refresh();
    void ListWebviewPanel.currentPanel?.refresh();
  };

  // Collapses tree items inside every LabShelf view at once — same effect as
  // clicking each view's individual "collapse all" button. VS Code has no API to
  // close the section panels themselves, so this is the closest equivalent.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.collapseAllSections", async () => {
      const viewIds = [
        "labshelf.library",
      ];
      for (const id of viewIds) {
        await vscode.commands.executeCommand(`workbench.actions.treeView.${id}.collapseAll`);
      }
    }),
  );

  // SETTINGS sidebar view — empty tree provider so viewsWelcome (defined in
  // package.json) renders its "Open settings" link as the section content.
  const emptyProvider: vscode.TreeDataProvider<never> = {
    getTreeItem: (e: never) => e,
    getChildren: () => [],
  };
  context.subscriptions.push(
    vscode.window.createTreeView("labshelf.settings", { treeDataProvider: emptyProvider }),
  );

  // Settings webpanel — currently the only place to manage Drive, sync interval, etc.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openSettings", () => {
      SettingsWebviewPanel.createOrShow(context.extensionUri, {
        getLibraryRoot: () => libraryRoot ?? null,
        getSyncController: () => syncController,
        reconfigureLibrary: async () => {
          const root = await runLibrarySetupWizard(context, createFileSystem);
          if (!root) { return undefined; }
          libraryRoot = root;
          activeServices = await buildServices(context, root, eventBus);
          libraryProvider.setPapersRoot(libraryLayout(root, vscode.Uri.joinPath).papersRoot());
          await ensureSyncController(root, activeServices);
          return root;
        },
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openListTab", (node?: LibraryNode) => {
      requireServices().then((services) => {
        if (services) {
          ListWebviewPanel.createOrShow(
            {
              extensionUri: context.extensionUri,
              paperService: services.paperService,
              eventBus,
              getPapersRoot: () => papersRootUri()?.fsPath ?? null,
              onDidNavigate: syncTreeToPanel,
              textLayerJobs: { current: currentTextLayerJobs, onDidChange: onTextLayerJobsChanged },
              loadSidecar: (paperId) => services.paperDataStore.load(paperId),
              findSimilar: (paper) => findSimilarPapers(aiService, paper),
            },
            node,
          );
        }
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openPdfViewer", async (paperId?: string, page?: number) => {
      const services = await requireServices();
      if (!services) { return; }
      // Without an id (command palette) the user picks the paper.
      const paper = await resolvePaper(services.paperService, paperId, "Open paper in the reader");
      if (!paper) { return; }
      // One guard covers every reader entry point (double-click, Enter, child
      // row, detail button, palette): a PDF-less paper warns and opens nothing.
      if (!(await ensurePaperPdf(services, paper))) { return; }
      PdfViewerPanel.createOrShow(
        {
          extensionUri: context.extensionUri,
          eventBus,
          themeManager: services.themeManager,
          annotationManager: services.annotationManager,
          readingStore: services.paperDataStore,
          logger: services.logger,
          onReadingEvent: (event) => aiService?.recordReadingEvent(event),
        },
        paper,
        typeof page === "number" ? { page } : {},
      );
    }),
    vscode.commands.registerCommand("labshelf.exportAnnotations", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      const paper = await resolvePaper(services.paperService, paperId, "Export annotations to Markdown");
      if (!paper) { return; }
      const target = await vscode.window.showQuickPick(
        [{ label: "Copy to clipboard", target: "clipboard" as const }, { label: "Save as file...", target: "file" as const }],
        { placeHolder: "Export annotations as Markdown" },
      );
      if (target) { await PdfViewerPanel.exportAnnotations(services.annotationManager, paper, target.target); }
    }),
    // Contributed keybindings (scoped to the focused reader panel) land here: VS Code resolves those chords
    // before the webview sees them, so the reader cannot rely on its own keydown handler alone.
    ...READER_COMMANDS.map((id) =>
      vscode.commands.registerCommand(`labshelf.reader.${id}`, () => { PdfViewerPanel.postToActive(id); }),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.library.refresh", () => libraryProvider.refresh()),
  );

  registerFolderCommands(context, folderHost);

  // Import papers into a specific folder selected via the tree context menu.
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

      await importPapers(services, selected, node?.dirPath);
    }),
  );

  // Configure or reconfigure the library root via the setup wizard.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.configureLibrary", async () => {
      const root = await runLibrarySetupWizard(context, createFileSystem);
      if (!root) { return; }

      libraryRoot = root;
      activeServices = await buildServices(context, root, eventBus);
      libraryProvider.setPapersRoot(libraryLayout(root, vscode.Uri.joinPath).papersRoot());
      await ensureSyncController(root, activeServices);
      vscode.window.showInformationMessage(`LabShelf: Library configured at ${root.fsPath}`);
    }),
  );

  // Sync commands require the library to be configured before delegating to SyncController.
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
  registerAiCommands(context, () => aiService);

  if (activeServices) {
    const services = activeServices;
    eventBus.on("paper:added", async (payload) => {
      await services.logger.log("INFO", "extension", "Paper added", { payload });
    });
    eventBus.on("paper:updated", async (payload) => {
      await services.logger.log("INFO", "extension", "Paper updated", { payload });
    });
  }
}

/** Called by VS Code on extension deactivation — cleanup is handled via disposables */
export function deactivate(): void { return; }

// True when a sync pulled, removed or conflicted files in the library
// namespace — the cases where on-disk papers (or their PDFs) changed and the
// index must be rebuilt. Uploads alone need no re-index.
function syncChangedLibrary(result: SyncResult): boolean {
  return result.namespaces.some(
    (ns) => ns.namespace === "library" && (ns.downloaded > 0 || ns.deletedLocal > 0 || ns.conflicts.length > 0),
  );
}

// Spins up the AI service when a library is configured. Resolution failures
// degrade the AI subsystem instead of breaking activation; the rest of the
// extension keeps working.
async function maybeStartAi(
  context: vscode.ExtensionContext,
  eventBus: EventBus,
  services: ActiveServices,
): Promise<AiService | null> {
  try {
    if (!(services.database instanceof SqliteResearchDatabase)) return null;
    const result = await createAiService({
      context,
      database: services.database,
      fileSystem: services.fileSystem,
      eventBus,
      logger: services.logger,
      pdfOpener: new NodePdfOpener(),
      resolvePdfUri: (paperId) => services.paperService.resolvePdfUri(paperId),
    });
    if (!result) return null;
    context.subscriptions.push({ dispose: result.dispose });
    return result.service;
  } catch (error) {
    void services.logger.log("WARN", "extension", "AI service failed to start", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Builds the OCR fallback used when a PDF's text layer cannot be read.
// Returns undefined when the user has turned it off, so imports skip it entirely.
function createOcrEngine(
  context: vscode.ExtensionContext,
  logger: ILogger,
): TesseractOcrEngine | undefined {
  const config = vscode.workspace.getConfiguration("labshelf");
  if (!config.get<boolean>("ocr.enabled", true)) {
    return undefined;
  }

  const languages = config.get<string[]>("ocr.languages", ["eng"]);
  const engine = new TesseractOcrEngine({
    languages,
    // Language data is downloaded once and reused across sessions.
    cachePath: vscode.Uri.joinPath(context.globalStorageUri, "ocr-cache").fsPath,
    onDiagnostic: (message) => void logger.log("INFO", "ocr", message),
  });
  context.subscriptions.push({ dispose: () => void engine.dispose() });
  return engine;
}

// Builds the step that classifies PDFs and gives scans a selectable text layer.
// It shares the import's OCR engine; with OCR off it still classifies, so the
// library can flag scans. labshelf.ocr.makeSearchable only governs whether
// that runs on its own after an import (commands/importProgress.ts).
function createTextLayerBuilder(engine: TesseractOcrEngine | undefined): SearchablePdfBuilder {
  const config = vscode.workspace.getConfiguration("labshelf");
  return new SearchablePdfBuilder(engine, { maxPages: config.get<number>("ocr.maxPages", 150) });
}

// Constructs and wires all application services for the given library root.
async function buildServices(
  context: vscode.ExtensionContext,
  root: vscode.Uri,
  eventBus: EventBus,
): Promise<ActiveServices> {
  const paths = libraryLayout(root, vscode.Uri.joinPath);
  const fileSystem = createFileSystem(root);
  await ensureLibraryStructure(root, fileSystem);
  const database = await initializeDatabase(paths.indexPath(), fileSystem);
  const logger = createExtensionLogger(paths.appLogPath().fsPath, { append: (entry) => database.appendLog(entry) });
  const ocrEngine = createOcrEngine(context, logger);
  const pdfImportParser = new PdfImportParser(new NodePdfOpener(), { ocr: ocrEngine });
  const bibTeXService = new BibTeXService(fileSystem);
  const mutations: MutationContext = {
    fs: fileSystem, paths: path, artifacts: bibTeXService, logger, papersRoot: paths.papersRoot().fsPath,
  };
  const parse = (bytes: Uint8Array, stem: string) => pdfImportParser.parse(bytes, stem);
  const paperService = new PaperService(mutations, database, eventBus, bibTeXService, parse);
  const importer = new PaperImporter(mutations, database, eventBus, parse);
  const textLayers = new PaperTextLayers(mutations, paperService, createTextLayerBuilder(ocrEngine));
  const paperDataStore = new PaperDataStore(paths, fileSystem);
  const indexer = new LibraryIndexer(paths, fileSystem, database);
  await indexer.rebuild();
  // Papers imported before text layers were tracked are classified once, in the
  // background and without OCR; the verdict is saved in metadata.yaml. Papers
  // saved without a PDF have nothing to read and are left out.
  const indexed = await database.listPapers();
  const toCheck = indexed.filter((paper) => paper.hasPdf !== false && !paper.textLayer);
  if (toCheck.length > 0) {
    void queueTextLayers(textLayers, toCheck, { mode: "check", logger });
  }
  const themeManager = new ThemeManager(paperDataStore);
  const annotationManager = new AnnotationManager(paperDataStore, eventBus);
  const reindex = () =>
    reindexLibrary({
      database,
      indexer,
      eventBus,
      queueCheck: (papers) => void queueTextLayers(textLayers, papers, { mode: "check", logger }),
    });
  return {
    paperService, importer, textLayers, mutations, logger, themeManager, annotationManager, database, paperDataStore, fileSystem,
    reindexLibrary: reindex,
  };
}

// Tries to create the SQLite database; falls back to the in-memory implementation on failure.
async function initializeDatabase(indexPath: vscode.Uri, fileSystem: IFileSystem): Promise<IResearchDatabase> {
  try {
    const { createSqliteResearchDatabase } = await import("./db/sqliteResearchDatabase.js");
    const database = await createSqliteResearchDatabase(indexPath, fileSystem);
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
