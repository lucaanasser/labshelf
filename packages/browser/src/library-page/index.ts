/**
 * Library page bootstrap. Builds the three-column app shell and initialises the
 * state store. Views and controllers are attached in the next commit; for now
 * the panes show placeholder copy so the layout can be reviewed standalone.
 *
 * @depends platform/logger, state/libraryStore, app
 * @dependents library-page/index.html
 */
import { BrowserLogger } from "../platform/logger";
import { LibraryStore } from "./state/libraryStore";
import { buildApp } from "./app";

const log = new BrowserLogger("library");

function placeholder(text: string): string {
  return `<p class="empty">${text}</p>`;
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  const store = new LibraryStore();
  const mounts = buildApp(root, store);

  mounts.sidebar.innerHTML =
    `<header class="pane__header">Collections</header>${placeholder("Tree view loads next.")}`;
  mounts.main.innerHTML =
    `<header class="pane__header">Papers</header>${placeholder("Paper list loads next.")}`;
  mounts.aside.innerHTML =
    `<header class="pane__header">Details</header>${placeholder("Select a paper to inspect it.")}`;
  mounts.breadcrumb.textContent = "LIBRARY";
  mounts.footerLeft.textContent = "READY";
  mounts.footerRight.textContent = "0 PAPERS";

  await log.info("library page mounted");
}

void boot().catch((err: unknown) => {
  void log.error("library", err);
});
