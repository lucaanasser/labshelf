/**
 * Entry of the reader page (reader/index.html?paper=<id>[&page=<n>]): the browser extension's counterpart of the VS Code
 * reader panel. It starts the very same reader UI (startReader from @labshelf/core/dom) with boot parameters built here
 * (pdf.js from the extension's vendor/pdfjs/, the PDF bytes from IndexedDB) and an in-page host that keeps the paper's
 * annotations, reader theme and reading position in its synced sidecar.
 */
import {
  PROTOCOL_VERSION,
  PaperDataStore,
  type EffectiveTheme,
  type HostToWebview,
  type ReaderBootParams,
  type PaperRecord,
} from "@labshelf/core";
import { startReader, PerfMarks } from "@labshelf/core/dom";
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import type { RuntimeMessage } from "../platform/runtimeMessages";
import { IndexedDbFileSystem, getRecord } from "../storage";
import { getThemePref, onThemeChange, resolveTheme } from "../ui/theme";
import { toast } from "../ui/toast";
import { BrowserReaderHost, type ReaderHostLogger } from "./browserReaderHost";
import { createIdbSidecarPort } from "./idbSidecarPort";
import { createInPageChannel } from "./inPageTransport";
import { loadReaderPrefs, onReaderPrefsChange } from "./readerPrefsStore";
import { parseReaderQuery } from "./readerTabs";

// First statement, so scriptStart measures the whole open like in VS Code.
const perf = new PerfMarks();
const logger = new BrowserLogger("reader");
const fs = new IndexedDbFileSystem();
const PDFJS = "vendor/pdfjs/";

function asset(path: string): string {
  return bx.runtime.getURL(`${PDFJS}${path}`);
}

function showFatal(message: string): void {
  const loading = document.getElementById("loading-msg");
  const error = document.getElementById("error-msg");
  if (loading) loading.hidden = true;
  if (error) { error.hidden = false; error.textContent = message; }
}

function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

function autoTheme(): EffectiveTheme {
  return resolveTheme(getThemePref());
}

const hostLog: ReaderHostLogger = {
  info: (message, context) => { void logger.info(message, context); },
  warn: (message, context) => { void logger.warn(message, context); },
  error: (error, context) => { void logger.error("reader", error, context); },
};

/** Chords VS Code's webview frame swallows (print, save) and drops that would navigate the tab away from the paper. */
function installPageGuards(): void {
  const mac = isMacPlatform();
  document.addEventListener("keydown", (e) => {
    const mod = mac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && (key === "p" || key === "s")) { e.preventDefault(); return; }
    // Firefox opens Quick Find on these when nothing handles them; the reader has its own find bar.
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (!typing && !mod && !e.altKey && (e.key === "/" || e.key === "'") && !e.defaultPrevented) e.preventDefault();
  });
  for (const type of ["dragover", "drop"] as const) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
}

async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

async function openExternal(url: string): Promise<void> {
  const current = await bx.tabs.getCurrent().catch(() => undefined);
  await bx.tabs.create({
    url,
    active: true,
    ...(current?.index !== undefined ? { index: current.index + 1 } : {}),
    ...(current?.id !== undefined ? { openerTabId: current.id } : {}),
  });
}

async function saveFile(fileName: string, text: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  try {
    await bx.downloads.download({ url, filename: fileName, saveAs: true });
  } finally {
    // The download has its own copy once started; a cancelled dialog needs nothing either.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function scheduleSync(reason: string): void {
  const msg: RuntimeMessage = { type: "sync.scheduleSoon", reason };
  void bx.runtime.sendMessage(msg).catch(() => undefined);
}

async function readPdfBytes(paper: PaperRecord): Promise<ArrayBuffer> {
  const bytes = await fs.readFile(`${paper.path}/paper.pdf`);
  // pdf.js transfers the buffer to its worker; hand it a private copy of exactly the file's bytes.
  return bytes.slice().buffer;
}

async function main(): Promise<void> {
  installPageGuards();
  const { paperId, page } = parseReaderQuery(location.search);
  if (!paperId) { showFatal("No paper was given to open. Open a paper from the LabShelf library."); return; }

  const [paper, prefs] = await Promise.all([getRecord(paperId), loadReaderPrefs()]);
  if (!paper) {
    showFatal("This paper is no longer in your LabShelf library. It may have been removed, or the library has not synced yet.");
    void logger.warn("reader opened for an unknown paper", { paperId });
    return;
  }
  document.title = paper.title;
  if (!(await fs.stat(`${paper.path}/paper.pdf`))?.isFile) {
    showFatal("This paper has no PDF yet — it was saved from a page that did not offer one.");
    return;
  }

  let currentPrefs = prefs;
  const store = new PaperDataStore(createIdbSidecarPort(fs));
  // The host answers through the channel, which needs the host to exist first.
  let send: (msg: HostToWebview) => void = () => undefined;
  const host: BrowserReaderHost = new BrowserReaderHost({
    paper,
    store,
    post: (msg) => send(msg),
    getPrefs: () => currentPrefs,
    autoTheme,
    writeClipboard,
    notify: (message, kind) => { toast(message, kind); },
    openExternal,
    saveFile,
    scheduleSync,
    log: hostLog,
  }, page !== undefined ? { page } : {});
  const channel = createInPageChannel((msg) => { void host.handle(msg); });
  send = channel.send;

  const boot: ReaderBootParams = {
    protocolVersion: PROTOCOL_VERSION,
    assets: {
      pdfjsUrl: asset("build/pdf.min.mjs"),
      viewerUrl: asset("web/pdf_viewer.mjs"),
      workerUrl: asset("build/pdf.worker.min.mjs"),
      // Unused: the bytes come from IndexedDB through the readBytes hook.
      pdfUrl: "",
      cMapUrl: asset("cmaps/"),
      stdFontUrl: asset("standard_fonts/"),
      wasmUrl: asset("wasm/"),
      iccUrl: asset("iccs/"),
    },
    paperId: paper.id,
    paperTitle: paper.title,
    themePreference: "auto",
    effectiveTheme: autoTheme(),
    prefs,
    isMac: isMacPlatform(),
  };

  window.labshelfReader = {
    paperId: paper.id,
    async reveal(target?: number) {
      const tab = await bx.tabs.getCurrent();
      if (tab?.id !== undefined) await bx.tabs.update(tab.id, { active: true });
      if (tab?.windowId !== undefined) await bx.windows.update(tab.windowId, { focused: true });
      if (target) host.requestPage(target);
    },
  };

  onThemeChange((theme) => host.onAutoThemeChange(theme));
  onReaderPrefsChange((next) => { currentPrefs = next; host.onPrefsChange(next); });
  // A sync may have brought annotations made in VS Code while this tab was in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void host.refreshAnnotations().catch(() => undefined);
  });

  void logger.info("reader opened", { paperId: paper.id, page: page ?? null });
  await startReader({
    boot,
    transport: channel.transport,
    perf,
    pdf: {
      readBytes: () => readPdfBytes(paper),
      // MV3 pages may not start blob: workers (Firefox refuses them); the extension's own module URL works everywhere.
      createWorker: (url) => new Worker(url, { type: "module" }),
    },
  });
}

main().catch((err: unknown) => {
  void logger.error("reader", err, { op: "open" });
  // startReader already shows its own load errors; anything earlier (storage) lands here.
  const error = document.getElementById("error-msg");
  if (error?.hidden) showFatal(`Failed to open the paper: ${err instanceof Error ? err.message : String(err)}`);
});
