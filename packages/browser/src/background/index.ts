/**
 * Background entry. In MV3 Chrome this runs as a service worker; in Firefox
 * it runs as a non-persistent background script. Wires Drive auth, sync
 * controller, capture, the Phase 7 schedulers (alarm + idle + debouncer) and
 * the toolbar badge updater into the runtime message channel so popup,
 * options, library-page and the Google Scholar buttons can drive every flow.
 * @depends platform/browserApi, platform/logger, platform/runtimeMessages, platform/settings,
 *          sync/auth/browserDriveAuth, sync/browserSyncController, capture/index,
 *          storage, library-page/state/derive, library-page/router,
 *          background/draftCache, background/autoSyncScheduler, background/syncOnIdle,
 *          background/eventDebouncer, background/badgeUpdater.
 * @dependents none (entry point).
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import type {
  AttachPdfData, DraftView, FolderOption, FoldersData, LibraryChangedBroadcast, LibraryRef, LookupData,
  LookupItem, PdfStatusData, RuntimeMessage, RuntimeResponse, SaveOutcome, SavedPaperData, TabSummary,
} from "../platform/runtimeMessages";
import { getSettings } from "../platform/settings";
import { BrowserDriveAuth } from "../sync/auth/browserDriveAuth";
import { BrowserSyncController } from "../sync/browserSyncController";
import {
  attachPdfToPaper, draftFromRecord, findInLibrary, findPdf, refreshExisting, resetPdfSearch,
  safeFolder, saveOrAsk, summarizeAttempts,
} from "../capture/index";
import type { CaptureDraft, SaveDecision, SavedPaper } from "../capture/index";
import { IndexedDbFileSystem, buildFolderTree, deleteRecord, listAllRecords, pdfDirs } from "../storage";
import type { FolderNode } from "../storage";
import { ROOT, parentDir } from "../library-page/state/derive";
import { hashForFolder } from "../library-page/router";
import { draftForTab, forgetDraft, forgetPaper, scholarDraftFor } from "./draftCache";
import { isScholarUrl } from "../content/scholarParse";
import { installAutoSyncScheduler } from "./autoSyncScheduler";
import type { SyncTrigger } from "./autoSyncScheduler";
import { installIdleSyncTrigger } from "./syncOnIdle";
import { SyncDebouncer } from "./eventDebouncer";
import { installBadgeUpdater } from "./badgeUpdater";

const log = new BrowserLogger("background");
const auth = new BrowserDriveAuth();
const sync = new BrowserSyncController(auth);

const triggerSync: SyncTrigger = (reason) => {
  void log.info("sync trigger", { reason });
  void sync.sync()
    .then(() => {
      void log.info("sync completed", sync.status() as unknown as Record<string, unknown>);
      // A sync may have downloaded PDFs; let open pages refresh presence.
      broadcastChanged("sync");
    })
    .catch((err: unknown) => log.error("background", err, { op: "trigger", reason }));
};

const debouncer = new SyncDebouncer(triggerSync);

void installAutoSyncScheduler({ trigger: triggerSync, logger: log });
installIdleSyncTrigger({ trigger: triggerSync, logger: log });
installBadgeUpdater(() => sync.status());

bx.runtime.onInstalled.addListener((details) => {
  void log.info("extension installed", { reason: details.reason });
});

bx.runtime.onStartup.addListener(() => {
  void log.info("browser startup");
});

// Web pages reach the background only through the Scholar content script,
// and only for what its buttons need; everything else is for extension pages.
const PAGE_MESSAGES: ReadonlySet<RuntimeMessage["type"]> = new Set(["scholar.save", "library.lookup", "library.folders", "library.open"]);

function allowedFrom(msg: RuntimeMessage, sender: { url?: string }): boolean {
  if (sender.url?.startsWith(bx.runtime.getURL(""))) return true;
  return PAGE_MESSAGES.has(msg?.type) && isScholarUrl(sender.url);
}

bx.runtime.onMessage.addListener(async (message: unknown, sender: { url?: string }) => {
  const msg = message as RuntimeMessage;
  // The background's own library.changed broadcast is not a request; if the
  // runtime delivers it back here, ignore it before the exhaustive switch.
  if ((message as LibraryChangedBroadcast | undefined)?.type === "library.changed") return undefined;
  if (!allowedFrom(msg, sender)) {
    void log.warn("message refused", { type: msg?.type ?? null, from: sender.url ?? null });
    return { ok: false, error: "Not allowed from this page" } satisfies RuntimeResponse;
  }
  try {
    const data = await handle(msg);
    return { ok: true, data } satisfies RuntimeResponse;
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    void log.error("background", err, { type: msg?.type });
    return { ok: false, error } satisfies RuntimeResponse;
  }
});

async function handle(msg: RuntimeMessage): Promise<unknown> {
  switch (msg.type) {
    case "ping":
      return { pong: true, at: new Date().toISOString() };
    case "auth.status":
      return { connected: auth.isAuthenticated() };
    case "auth.connect":
      await auth.authenticate();
      await log.info("authenticated to Google Drive");
      return { connected: true };
    case "auth.disconnect":
      await auth.revoke();
      await log.info("disconnected from Google Drive");
      return { connected: false };
    case "sync.status":
      return sync.status();
    case "sync.now": {
      // Fire-and-forget so the popup updates immediately. Cancel any pending
      // debounced sync — it would just duplicate this one.
      void debouncer.cancel();
      void sync.sync()
        .then(() => {
          void log.info("sync completed", sync.status() as unknown as Record<string, unknown>);
          broadcastChanged("sync");
        })
        .catch((err: unknown) => log.error("background", err, { op: "sync.now" }));
      return sync.status();
    }
    case "sync.scheduleSoon":
      await debouncer.schedule(msg.reason);
      return { scheduled: true };
    case "capture.inspect": {
      const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId));
      const view = await draftView(draft);
      // Start the PDF search now; also for a library copy that still has no PDF,
      // so the popup can offer to attach what this page yields. The popup asks
      // for the result separately.
      if (draft.isPaper && !view.existing?.hasPdf) void findPdf(draft);
      return view;
    }
    case "capture.findPdf": {
      const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId));
      const pdf = await findPdf(draft);
      return (pdf
        ? { found: true, source: pdf.source }
        : { found: false, miss: summarizeAttempts(draft.pdfAttempts) }) satisfies PdfStatusData;
    }
    case "capture.save": {
      const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId));
      if (msg.retryPdf) resetPdfSearch(draft);
      return outcome(draft, await saveOrAsk(draft, {
        ...(msg.folder ? { folder: msg.folder } : {}),
        ...(msg.tags ? { tags: msg.tags } : {}),
        ...(msg.note ? { note: msg.note } : {}),
      }, msg.ifNoPdf ?? "ask"));
    }
    case "capture.tab": {
      // Fresh look on the first call; the "Save without PDF" confirmation reuses
      // the cached draft (and its finished search).
      const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId), msg.ifNoPdf !== "save");
      if (msg.retryPdf) resetPdfSearch(draft);
      await refreshExisting(draft);
      // D4: the tab's paper may already be in the library — never write a duplicate.
      if (draft.existing) return libraryCopy(draft);
      return outcome(draft, await saveOrAsk(draft, msg.targetFolder ? { folder: msg.targetFolder } : {}, msg.ifNoPdf ?? "ask"));
    }
    case "scholar.save": {
      const draft = await scholarDraftFor(msg.hit);
      if (msg.retryPdf) resetPdfSearch(draft);
      await refreshExisting(draft);
      if (draft.existing) return libraryCopy(draft);
      return outcome(draft, await saveOrAsk(draft, msg.folder ? { folder: msg.folder } : {}, msg.ifNoPdf ?? "ask"));
    }
    case "capture.attachPdf": {
      const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId));
      if (!draft.existing) throw new Error("This paper is not in your library.");
      const id = draft.existing.id;
      // The search already ran at inspect; findPdf returns the memoised result.
      const pdf = await findPdf(draft);
      if (!pdf) return { id, attached: false, miss: summarizeAttempts(draft.pdfAttempts) } satisfies AttachPdfData;
      const { written } = await attachPdfToPaper(id, pdf.bytes);
      if (written) {
        void debouncer.schedule("capture.attachPdf");
        broadcastChanged("attach", id);
      }
      return { id, attached: written, ...(written ? { source: pdf.source } : { alreadyHadPdf: true }) } satisfies AttachPdfData;
    }
    case "paper.findPdf":
      return findPdfForPaper(msg.id);
    case "paper.remove": {
      const record = (await listAllRecords()).find((r) => r.id === msg.id);
      if (!record) return { removed: false };
      await deleteRecord(record.id);
      await new IndexedDbFileSystem().deleteDir(record.path);
      forgetPaper(record.id);
      void debouncer.schedule("paper.remove");
      broadcastChanged("remove", record.id);
      await log.info("paper removed from popup", { id: record.id });
      return { removed: true };
    }
    case "library.folders":
      return libraryFolders();
    case "library.lookup":
      return lookup(msg.items);
    case "library.open": {
      const folder = safeFolder(msg.folder);
      const query = msg.paperId ? `?paper=${encodeURIComponent(msg.paperId)}` : "";
      await bx.tabs.create({ url: `${bx.runtime.getURL("library-page/index.html")}${query}${hashForFolder(folder)}` });
      return { opened: true };
    }
    case "tabs.list": {
      const tabs = await bx.tabs.query({ currentWindow: true });
      return tabs
        .filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ""))
        .map((t) => ({ id: t.id!, title: t.title ?? "", url: t.url ?? "", active: t.active }) satisfies TabSummary);
    }
    default: {
      const exhaustive: never = msg;
      throw new Error(`Unhandled message type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

bx.tabs.onRemoved.addListener((tabId) => forgetDraft(tabId));

async function tabUrl(tabId: number): Promise<string> {
  const tab = await bx.tabs.get(tabId);
  return tab.url ?? "";
}

function ref(id: string, path: string, hasPdf: boolean): LibraryRef {
  return { id, path, folder: parentDir(path), hasPdf };
}

/** Whether `<path>/paper.pdf` exists (one stat; library.lookup uses a bulk scan). */
async function pdfExists(path: string): Promise<boolean> {
  return (await new IndexedDbFileSystem().stat(`${path}/paper.pdf`)) !== undefined;
}

async function draftView(d: CaptureDraft): Promise<DraftView> {
  const m = d.metadata;
  const venue = m.journal ?? m.publisher;
  return {
    isPaper: d.isPaper,
    title: m.title ?? "",
    authors: m.authors ?? [],
    origin: d.origin,
    ...(m.year ? { year: m.year } : {}),
    ...(venue ? { venue } : {}),
    ...(d.ids.doi ? { doi: d.ids.doi } : {}),
    ...(d.existing ? { existing: ref(d.existing.id, d.existing.path, await pdfExists(d.existing.path)) } : {}),
  };
}

/** Turns a consent-gated save decision into the reply the surfaces switch on. */
function outcome(draft: CaptureDraft, decision: SaveDecision): SaveOutcome {
  if (decision.kind === "saved") return saved(decision.saved);
  return {
    status: "no-pdf",
    title: draft.metadata.title ?? "Untitled",
    miss: decision.miss,
    ...(draft.pageUrl ? { pageUrl: draft.pageUrl } : {}),
  };
}

// A capture wrote to IDB; coalesce the follow-up sync and tell open pages.
function saved(result: SavedPaper): SavedPaperData {
  void debouncer.schedule("capture");
  const { paper } = result;
  broadcastChanged("capture", paper.id);
  return {
    ...ref(paper.id, paper.path, result.pdfSource !== null),
    status: "saved",
    title: paper.title,
    citeKey: paper.citeKey,
    pdfSource: result.pdfSource,
  };
}

async function libraryCopy(d: CaptureDraft): Promise<SavedPaperData> {
  const paper = d.existing!;
  return {
    ...ref(paper.id, paper.path, await pdfExists(paper.path)),
    status: "saved",
    title: paper.title,
    citeKey: paper.citeKey,
    pdfSource: null,
    alreadyInLibrary: true,
  };
}

/** Notifies extension pages (the library page) that the library changed. */
function broadcastChanged(reason: LibraryChangedBroadcast["reason"], paperId?: string): void {
  const b: LibraryChangedBroadcast = { type: "library.changed", reason, ...(paperId ? { paperId } : {}) };
  // Chrome rejects when no page is listening; that is not an error here.
  void bx.runtime.sendMessage(b).catch(() => undefined);
}

// "Find PDF" for a paper already saved (no tab). One run per id is kept in
// flight so repeated clicks share the search, and paper.pdf is written at the
// record's CURRENT path (attachPdfToPaper re-reads it).
const findingPdf = new Map<string, Promise<AttachPdfData>>();

async function findPdfForPaper(id: string): Promise<AttachPdfData> {
  const inflight = findingPdf.get(id);
  if (inflight) return inflight;
  const run = (async (): Promise<AttachPdfData> => {
    const record = (await listAllRecords()).find((r) => r.id === id);
    if (!record) throw new Error("This paper is no longer in your library.");
    const draft = await draftFromRecord(record);
    const pdf = await findPdf(draft);
    if (!pdf) return { id, attached: false, miss: summarizeAttempts(draft.pdfAttempts) };
    const { written } = await attachPdfToPaper(id, pdf.bytes);
    if (written) {
      void debouncer.schedule("paper.findPdf");
      broadcastChanged("attach", id);
    }
    return { id, attached: written, ...(written ? { source: pdf.source } : { alreadyHadPdf: true }) };
  })();
  findingPdf.set(id, run);
  void run.catch(() => undefined).finally(() => { if (findingPdf.get(id) === run) findingPdf.delete(id); });
  return run;
}

async function libraryFolders(): Promise<FoldersData> {
  const [tree, settings] = await Promise.all([buildFolderTree(ROOT), getSettings()]);
  const folders: FolderOption[] = [{ path: ROOT, label: "Library", depth: 0 }];
  const walk = (nodes: FolderNode[], depth: number): void => {
    for (const n of nodes) { folders.push({ path: n.path, label: n.name, depth }); walk(n.children, depth + 1); }
  };
  walk(tree, 1);
  // A remembered folder that was since deleted or renamed falls back to the root.
  const lastFolder = folders.some((f) => f.path === settings.lastFolder) ? settings.lastFolder : ROOT;
  return { folders, lastFolder };
}

async function lookup(items: LookupItem[]): Promise<LookupData> {
  const [records, dirs] = await Promise.all([listAllRecords(), pdfDirs()]);
  const out: LookupData = {};
  for (const item of items) {
    const hit = findInLibrary(records, item);
    if (hit) out[item.key] = ref(hit.id, hit.path, dirs.has(hit.path));
  }
  return out;
}
