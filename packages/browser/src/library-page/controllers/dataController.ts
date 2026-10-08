/**
 * Bridges the LibraryStore to the IndexedDB-backed storage layer and the
 * background runtime. Performs the initial load (folders + every paper +
 * sync status), reloads after mutations, and polls sync status while a sync
 * is in flight so the status bar updates without a user action.
 *
 * @depends storage (scanLibrary, listAllRecords), state/libraryStore, state/uiPrefs,
 *          platform/browserApi, platform/runtimeMessages, ui/toast, events
 * @dependents library-page/index, controllers/folderController, controllers/paperController
 */
import { bx } from "../../platform/browserApi";
import type { LibraryChangedBroadcast, RuntimeMessage, RuntimeResponse, SyncStatusData } from "../../platform/runtimeMessages";
import { listAllRecords, scanLibrary } from "../../storage";
import { toast } from "../../ui/toast";
import { on } from "../events";
import type { LibraryStore } from "../state/libraryStore";
import { loadPrefs } from "../state/uiPrefs";

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_TICKS = 120;

/** Sends a typed runtime message and unwraps the envelope. */
export async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

/** Pulls the folder tree, PDF presence, every paper and the sync snapshot into the store. */
export async function initLibraryData(store: LibraryStore): Promise<void> {
  const prefs = loadPrefs();
  store.set({ loading: true, sortKey: prefs.sortKey, sortDir: prefs.sortDir, includeSub: prefs.includeSub });
  try {
    // scanLibrary derives the tree and the pdf-presence set from a single key scan.
    const [scan, papers, sync] = await Promise.all([
      scanLibrary("papers"),
      listAllRecords(),
      send<SyncStatusData>({ type: "sync.status" }).catch(() => null),
    ]);
    store.set({ folders: scan.tree, pdfDirs: scan.pdfDirs, papers, sync, loading: false });
  } catch (err) {
    store.set({ loading: false });
    toast(`Could not load the library — ${errorMessage(err)}`, "error");
  }
}

/** Re-reads folders, PDF presence and papers from IDB after a local mutation or a sync. */
export async function refreshLibrary(store: LibraryStore): Promise<void> {
  const [scan, papers] = await Promise.all([scanLibrary("papers"), listAllRecords()]);
  store.set({ folders: scan.tree, pdfDirs: scan.pdfDirs, papers });
}

/**
 * Asks the background to coalesce a sync after a local mutation. Fire-and-
 * forget: errors are logged by the background side, the UI keeps going.
 * @usedBy controllers/folderController, controllers/paperController
 */
export function scheduleSyncSoon(reason: string): void {
  void send({ type: "sync.scheduleSoon", reason }).catch(() => undefined);
}

/** Runs a sync now and reflects its status in the store. */
export async function syncNow(store: LibraryStore): Promise<void> {
  try {
    const status = await send<SyncStatusData>({ type: "sync.now" });
    store.set({ sync: status });
  } catch (err) {
    toast(`Sync failed — ${errorMessage(err)}`, "error");
  }
}

/**
 * Subscribes to store changes and intents that require background work:
 * - whenever sync is in flight, poll sync.status until it settles, then refresh;
 * - the status-bar sync item;
 * - refresh when the page becomes visible again, or when the background says
 *   the library changed (a capture, attach, remove or sync happened elsewhere).
 */
export function subscribeBackgroundEvents(store: LibraryStore): () => void {
  const offSync = store.select(
    (s) => s.sync?.syncing ?? false,
    (syncing) => { if (syncing) void pollUntilDone(store); },
  );
  const offIntent = on("labshelf:sync-now", () => { void syncNow(store); });

  // Captures from the popup / Scholar, background auto-syncs and the Find PDF
  // flow all change the library while this page is open but did not start a
  // sync here, so the sync poll above never fires for them.
  const onVisible = (): void => { if (document.visibilityState === "visible") void refreshLibrary(store); };
  document.addEventListener("visibilitychange", onVisible);

  // MUST stay synchronous and NOT return a Promise: runtime.sendMessage
  // broadcasts every popup → background request to extension pages too, so a
  // listener returning a Promise here would race and answer those with undefined.
  const onRuntime = (msg: unknown): void => {
    if ((msg as LibraryChangedBroadcast | undefined)?.type === "library.changed") void refreshLibrary(store);
  };
  bx.runtime.onMessage.addListener(onRuntime);

  return () => {
    offSync();
    offIntent();
    document.removeEventListener("visibilitychange", onVisible);
    bx.runtime.onMessage.removeListener(onRuntime);
  };
}

async function pollUntilDone(store: LibraryStore): Promise<void> {
  for (let i = 0; i < POLL_MAX_TICKS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const sync = await send<SyncStatusData>({ type: "sync.status" });
      store.set({ sync });
      if (!sync.syncing) {
        await refreshLibrary(store);
        if (sync.lastError) toast(`Sync failed — ${sync.lastError}`, "error");
        return;
      }
    } catch (err) {
      toast(`Sync status unavailable — ${errorMessage(err)}`, "error");
      return;
    }
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
