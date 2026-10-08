/**
 * Library page bootstrap. Builds the shell once, mounts every view, attaches
 * the folder/paper controllers, binds the URL hash to the open folder, and
 * triggers the initial data load. Navigation never rebuilds the shell.
 *
 * @depends platform/logger, ui/theme, state/libraryStore, app, router, views/*, controllers/*
 * @dependents library-page/index.html
 */
import { BrowserLogger } from "../platform/logger";
import { applyTheme } from "../ui/theme";
import { buildApp } from "./app";
import { attachRouter } from "./router";
import { LibraryStore } from "./state/libraryStore";
import { mountSidebar } from "./views/sidebarTreeView";
import { mountListHeader } from "./views/listHeaderView";
import { mountFilterBar } from "./views/filterBarView";
import { mountPaperList } from "./views/paperListView";
import { mountDetailPane } from "./views/detailPaneView";
import { mountStatusBar } from "./views/statusBarView";
import { initLibraryData, subscribeBackgroundEvents } from "./controllers/dataController";
import { attachFolderController } from "./controllers/folderController";
import { attachPaperController } from "./controllers/paperController";

const log = new BrowserLogger("library");

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");

  applyTheme();
  const store = new LibraryStore();
  const mounts = buildApp(root);

  mountSidebar(mounts.sidebar, store);
  mountListHeader(mounts.listHeader, store);
  mountFilterBar(mounts.filterBar, store);
  mountPaperList(mounts.list, store);
  mountDetailPane(mounts.detail, store);
  mountStatusBar(mounts.statusBar, store);

  attachFolderController(store);
  attachPaperController(store);
  attachRouter(store);

  subscribeBackgroundEvents(store);
  await initLibraryData(store);
  // Opened from the popup or a Scholar button: select the paper just saved.
  const paperId = new URLSearchParams(location.search).get("paper");
  if (paperId && store.get().papers.some((p) => p.id === paperId)) store.selectOnly(paperId);
  await log.info("library page mounted");
}

void boot().catch((err: unknown) => {
  void log.error("library", err);
});
