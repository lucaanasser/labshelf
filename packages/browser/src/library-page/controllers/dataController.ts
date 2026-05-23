/**
 * Bridges the LibraryStore to the IndexedDB-backed storage layer and the
 * background runtime. Performs the initial load (folders + papers + sync
 * status), keeps the papers slice in sync with the selected folder, and polls
 * sync status while a sync is in flight so the footer pill updates without a
 * user action.
 *
 * @depends storage (buildFolderTree, listByFolder), state/libraryStore,
 *          platform/browserApi, platform/runtimeMessages
 * @dependents library-page/index, controllers/folderController, controllers/paperController
 */
import { bx } from "../../platform/browserApi";
import type {
  RuntimeMessage,
  RuntimeResponse,
  SyncStatusData,
} from "../../platform/runtimeMessages";
import { buildFolderTree, listByFolder } from "../../storage";
import type { LibraryStore } from "../state/libraryStore";

const POLL_INTERVAL_MS = 1500;

async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

/** Pulls the folder tree, the papers slice and the sync snapshot into the store. */
export async function initLibraryData(store: LibraryStore): Promise<void> {
  store.set({ loading: true, error: null });
  try {
    const [folders, papers, sync] = await Promise.all([
      buildFolderTree("papers"),
      listByFolder(store.get().selectedFolder),
      send<SyncStatusData>({ type: "sync.status" }).catch(() => null),
    ]);
    store.set({ folders, papers, sync, loading: false });
  } catch (err) {
    store.set({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Re-reads the papers slice from IDB for the currently selected folder. */
export async function refreshPapersSlice(store: LibraryStore): Promise<void> {
  const papers = await listByFolder(store.get().selectedFolder);
  store.set({ papers });
}

/** Re-reads the folder tree from IDB and updates the store. */
export async function refreshFolders(store: LibraryStore): Promise<void> {
  const folders = await buildFolderTree("papers");
  store.set({ folders });
}

/**
 * Subscribes to store changes that require background work:
 * - whenever selectedFolder changes, reload the papers slice;
 * - whenever sync is in flight, poll sync.status until it settles, then refresh.
 */
export function subscribeBackgroundEvents(store: LibraryStore): () => void {
  const offFolder = store.select((s) => s.selectedFolder, () => { void refreshPapersSlice(store); });
  const offSync = store.select(
    (s) => s.sync?.syncing ?? false,
    (syncing) => { if (syncing) void pollUntilDone(store); },
  );
  return () => { offFolder(); offSync(); };
}

async function pollUntilDone(store: LibraryStore): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const sync = await send<SyncStatusData>({ type: "sync.status" });
      store.set({ sync });
      if (!sync.syncing) {
        // Sync done — re-pull folders + papers so the panes show new content.
        await Promise.all([refreshFolders(store), refreshPapersSlice(store)]);
        return;
      }
    } catch (err) {
      store.set({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
  }
}
