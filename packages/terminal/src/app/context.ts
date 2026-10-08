/**
 * Composition root of the terminal app (the counterpart of packages/vscode/src/extension.ts): builds the concrete
 * adapters and wires the services for one library. The TUI and the CLI both start here; nothing else instantiates
 * adapters.
 *
 * @depends app/*, library/*, sync/*, preview/*, platform/*, tui/graphics, @labshelf/core
 * @dependents main, cli/commands, ui/app
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { BibTeXService, PdfImportParser } from "@labshelf/core";

import type { SharedConfig } from "./config.js";
import { FileLogger } from "./logger.js";
import { LibraryPaths, ensureLibraryStructure } from "../library/libraryPaths.js";
import { LibraryStore } from "../library/libraryStore.js";
import { LibraryWatcher } from "../library/libraryWatcher.js";
import { TerminalPaperService } from "../library/paperService.js";
import { SidecarReader } from "../library/sidecars.js";
import { cacheDir } from "../platform/dirs.js";
import { NodeFileSystem } from "../platform/nodeFileSystem.js";
import { moveToTrash } from "../platform/system.js";
import { defaultRenderer, ThumbnailService } from "../preview/thumbnails.js";
import { CliDriveAuth, resolveOAuthClient } from "../sync/driveAuth.js";
import { SyncService } from "../sync/syncService.js";
import { createTokenStore } from "../sync/tokenStore.js";
import { detectImageProtocol, type ImageProtocol } from "../tui/graphics.js";

export interface AppContext {
  paths: LibraryPaths;
  config: SharedConfig;
  logger: FileLogger;
  store: LibraryStore;
  papers: TerminalPaperService;
  sidecars: SidecarReader;
  sync: SyncService;
  thumbnails: ThumbnailService;
  thumbnailRenderer: string;
  imageProtocol: ImageProtocol;
  /** Resolves once highlights and notes are in the search index (one-shot CLI searches wait for it). */
  annotationsReady: Promise<void>;
  /** Stops watchers and timers; resolves after an in-flight sync finished. */
  dispose(): Promise<void>;
}

export interface OpenOptions {
  config: SharedConfig;
  env?: NodeJS.ProcessEnv;
  /** Watch the library for changes made by other apps (the TUI does; one-shot CLI commands do not). */
  watch?: boolean;
  /** dist/thumbnailWorker.mjs, resolved by main from the bundle's location. */
  thumbnailWorkerUrl?: URL;
}

/**
 * Opens a library: creates its folder structure if needed, scans it, and wires every service.
 * @usedBy main, cli/commands
 * @returns the context
 */
export async function openLibrary(root: string, options: OpenOptions): Promise<AppContext> {
  const env = options.env ?? process.env;
  const paths = new LibraryPaths(root);
  await ensureLibraryStructure(paths);
  const logger = new FileLogger(paths.terminalLogPath());
  const store = new LibraryStore(paths);
  await store.reload();

  const auth = new CliDriveAuth(resolveOAuthClient(env), createTokenStore(env));
  const sync = new SyncService({ paths, auth, store, logger });
  await sync.init();

  let parser: PdfImportParser | undefined;
  const papers = new TerminalPaperService({
    paths,
    store,
    bibtex: new BibTeXService(new NodeFileSystem(paths.tmpDir())),
    logger,
    pdfParser: async () => {
      if (!parser) {
        const { NodePdfOpener } = await import("../platform/nodePdfOpener.js");
        parser = new PdfImportParser(new NodePdfOpener());
      }
      return parser;
    },
    trash: moveToTrash,
    onLocalChange: () => sync.notifyLocalChange(),
  });

  const sidecars = new SidecarReader(paths);
  const workerUrl = options.thumbnailWorkerUrl ?? pathToFileURL(path.join(bundleDir(), "thumbnailWorker.mjs"));
  const renderer = defaultRenderer(path.join(cacheDir(env), "tmp"), workerUrl);
  const thumbnails = new ThumbnailService(cacheDir(env), renderer.render, logger);
  const imageProtocol = detectImageProtocol(env, env["LABSHELF_IMAGES"] ?? options.config.terminal?.images ?? "auto");

  // Highlights and notes become searchable; refreshed in the background whenever the library changes.
  const indexAnnotations = (): Promise<void> =>
    sidecars.annotationIndex(store.snapshot.papers.keys()).then((index) => store.setAnnotationText(index), () => undefined);
  const annotationsReady = indexAnnotations();

  let watcher: LibraryWatcher | undefined;
  if (options.watch) {
    watcher = new LibraryWatcher(paths, () => {
      void store.reload().then(() => {
        void indexAnnotations();
        void sync.refreshLastRun();
      });
    }, logger);
    watcher.start();
  }

  await logger.log("INFO", "terminal/app", "Library opened", {
    root: paths.root, papers: store.snapshot.papers.size, sync: sync.status().state, images: imageProtocol, renderer: renderer.name,
  });

  return {
    paths,
    config: options.config,
    logger,
    store,
    papers,
    sidecars,
    sync,
    thumbnails,
    thumbnailRenderer: renderer.name,
    imageProtocol,
    annotationsReady,
    async dispose() {
      watcher?.stop();
      const pending = sync.stop();
      if (pending) { await pending.catch(() => undefined); }
    },
  };
}

// Directory of the running bundle; only used when main did not pass the worker URL (tests never render).
function bundleDir(): string {
  return typeof __dirname === "string" ? __dirname : process.cwd();
}
