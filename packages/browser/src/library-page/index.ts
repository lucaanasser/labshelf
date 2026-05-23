/**
 * Library page bootstrap. Builds the three-column shell, mounts every view,
 * attaches the folder/paper controllers, and triggers the initial data load.
 *
 * @depends platform/logger, state/libraryStore, app, views/*, controllers/*
 * @dependents library-page/index.html
 */
import { BrowserLogger } from "../platform/logger";
import { LibraryStore } from "./state/libraryStore";
import { buildApp } from "./app";
import { mountSidebar } from "./views/collectionsTreeView";
import { mountList } from "./views/paperListView";
import { mountDetail } from "./views/paperDetailView";
import { mountBreadcrumb, mountFooter } from "./views/toolbarView";
import { initLibraryData, subscribeBackgroundEvents } from "./controllers/dataController";
import { attachFolderController } from "./controllers/folderController";
import { attachPaperController } from "./controllers/paperController";

const log = new BrowserLogger("library");

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");

  const store = new LibraryStore();
  const mounts = buildApp(root, store);

  mountSidebar(mounts.sidebar, store);
  mountList(mounts.main, store);
  mountDetail(mounts.aside, store);
  mountBreadcrumb(mounts.breadcrumb, store);
  mountFooter(mounts.footerLeft, mounts.footerRight, store);

  attachFolderController(store);
  attachPaperController(store);

  subscribeBackgroundEvents(store);
  await initLibraryData(store);
  await log.info("library page mounted");
}

void boot().catch((err: unknown) => {
  void log.error("library", err);
});
