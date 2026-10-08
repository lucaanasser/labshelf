/**
 * Reacts to paper intents emitted by the list and detail pane. Handles
 * open-pdf (the LabShelf reader, one tab per paper — or, for a paper with no
 * usable PDF, an honest "find or attach" dialog), find-pdf (asks the background
 * to search the web and attach what it finds), attach-pdf (a local file picker),
 * copy-cite, status changes (rewrites metadata.yaml + record so the sync engine
 * uploads them), delete (with a VS Code-style confirmation whose copy omits the
 * PDF when none exists), move (drag-and-drop or a folder quick pick), and "Add"
 * — a quick pick over the open tabs that, when no PDF is found, asks before
 * saving the reference. Every mutation refreshes the store in place.
 *
 * @depends @labshelf/core BibTeXService FolderService IFileSystem PaperRecord,
 *          platform/runtimeMessages, storage, capture (attachPdfToPaper, isPdfBytes),
 *          ui/quickInput, ui/dialog, ui/toast, ui/pdfCopy, state/derive, events,
 *          controllers/dataController, reader/readerTabs
 * @dependents library-page/index
 */
import type { IFileSystem, PaperRecord, PaperStatus } from "@labshelf/core";
import { BibTeXService, FolderService } from "@labshelf/core";
import { attachPdfToPaper, isPdfBytes } from "../../capture";
import { openReader } from "../../reader/readerTabs";
import type { AttachPdfData, IfNoPdf, PdfMiss, SaveOutcome, TabSummary } from "../../platform/runtimeMessages";
import { IndexedDbFileSystem, deleteRecord, listAllRecords, upsertRecord } from "../../storage";
import { showDialog } from "../../ui/dialog";
import { noPdfDialogCopy, pdfSourceLabel } from "../../ui/pdfCopy";
import { quickPick } from "../../ui/quickInput";
import { toast } from "../../ui/toast";
import { on } from "../events";
import type { PaperAction } from "../events";
import { ROOT, ROOT_LABEL, baseName, flattenFolders, parentDir } from "../state/derive";
import type { LibraryStore } from "../state/libraryStore";
import { errorMessage, refreshLibrary, scheduleSyncSoon, send } from "./dataController";

/** Reject local PDFs above this size, matching the fetch layer's cap. */
const MAX_PDF_BYTES = 120 * 1024 * 1024;

const fs = new IndexedDbFileSystem();

// Wrap IndexedDbFileSystem in the text-oriented IFileSystem expected by
// BibTeXService so we can rewrite metadata.yaml after a status change.
class IdbTextAdapter implements IFileSystem {
  constructor(private readonly idb: IndexedDbFileSystem) {}
  async ensureDir(_path: string): Promise<void> {}
  async writeText(path: string, text: string): Promise<void> { await this.idb.writeFile(path, new TextEncoder().encode(text)); }
  async readText(path: string): Promise<string> { return new TextDecoder().decode(await this.idb.readFile(path)); }
  async exists(path: string): Promise<boolean> { return (await this.idb.stat(path)) !== undefined; }
}

const bib = new BibTeXService(new IdbTextAdapter(fs));
const folderService = new FolderService({
  listPapers: () => listAllRecords(),
  upsertPaper: (p) => upsertRecord(p, p.path),
  deletePaper: (id) => deleteRecord(id),
}, "/");

/** Attaches paper-intent listeners. Returns a disposer. */
export function attachPaperController(store: LibraryStore): () => void {
  const run = (work: () => Promise<void>): void => { void work().catch((err: unknown) => toast(errorMessage(err), "error")); };
  const offs = [
    on("labshelf:paper-action", ({ ids, action }) => run(() => handleAction(store, ids, action))),
    on("labshelf:set-status", ({ ids, status }) => run(() => setStatus(store, ids, status))),
    on("labshelf:move-papers", ({ ids, target }) => run(() => movePapers(store, ids, target))),
    on("labshelf:add-paper", () => run(() => addFromOpenTab(store))),
  ];
  return () => offs.forEach((off) => off());
}

async function handleAction(store: LibraryStore, ids: string[], action: PaperAction): Promise<void> {
  const byId = new Map(store.get().papers.map((p) => [p.id, p]));
  const papers = ids.map((id) => byId.get(id)).filter((p): p is PaperRecord => !!p);
  if (papers.length === 0) return;
  switch (action) {
    case "open-pdf": return openPdf(store, papers[0]!);
    case "copy-cite": return copyCite(papers[0]!);
    case "delete": return deletePapers(store, papers);
    case "move": return pickMoveTarget(store, papers.map((p) => p.id));
    case "find-pdf": return findPdfFor(store, papers[0]!);
    case "attach-pdf": return attachLocalPdf(store, papers[0]!);
  }
}

async function openPdf(store: LibraryStore, paper: PaperRecord): Promise<void> {
  // A key can exist with zero or corrupt bytes, so verify the header before
  // opening the reader; double-click / Enter also reach here for PDF-less rows.
  const pdfPath = `${paper.path}/paper.pdf`;
  const bytes = (await fs.stat(pdfPath)) ? await fs.readFile(pdfPath).catch(() => undefined) : undefined;
  if (!bytes || !isPdfBytes(bytes)) {
    const choice = await showDialog({
      title: "This paper has no PDF",
      message: "LabShelf has no PDF for this paper yet. Find one on the web automatically, or attach a file you already have.",
      severity: "info",
      buttons: [{ id: "attach", label: "Attach PDF…" }, { id: "find", label: "Find PDF", primary: true }],
    });
    if (choice === "find") await findPdfFor(store, paper);
    else if (choice === "attach") attachLocalPdf(store, paper);
    return;
  }
  // The same reader as the VS Code extension; an open tab for this paper is brought to the front instead.
  await openReader(paper.id);
}

/** Marks a paper's row/detail as searching (or clears it); a new Set keeps slice equality a reference check. */
function setPdfBusy(store: LibraryStore, id: string, busy: boolean): void {
  const next = new Set(store.get().pdfBusy);
  if (busy) next.add(id); else next.delete(id);
  store.set({ pdfBusy: next });
}

/** The "No PDF found" message for a paper already in the library (nothing is being saved here). */
function findMissMessage(title: string, miss: PdfMiss): string {
  const head = miss.tried > 0
    ? `LabShelf tried ${miss.tried} ${miss.tried === 1 ? "link" : "links"} but could not download a PDF for "${title}".`
    : `LabShelf found no PDF link, DOI or arXiv id for "${title}".`;
  const hint = miss.blocked ? " Some links were behind a bot check — opening the PDF once in a tab can let LabShelf through." : "";
  return `${head} Attach a file you already have, or search again later.${hint}`;
}

/** Asks the background to search the web for this paper's PDF and attach what it finds. */
async function findPdfFor(store: LibraryStore, paper: PaperRecord): Promise<void> {
  if (store.get().pdfBusy.has(paper.id)) return;          // a search is already running for this paper
  setPdfBusy(store, paper.id, true);
  const dismiss = toast("Looking for the PDF…", "info");
  let result: AttachPdfData;
  try {
    // Bytes are written by the background directly to IndexedDB; only the verdict crosses the wire.
    result = await send<AttachPdfData>({ type: "paper.findPdf", id: paper.id });
  } finally {
    dismiss();
    setPdfBusy(store, paper.id, false);
  }
  if (result.attached) {
    await refreshLibrary(store);
    toast(`PDF attached (via ${pdfSourceLabel(result.source)})`, "ok");
    return;
  }
  if (result.alreadyHadPdf) {
    await refreshLibrary(store);
    toast("This paper already has a PDF.", "info");
    return;
  }
  const miss: PdfMiss = result.miss ?? { tried: 0, sources: [], blocked: false };
  const choice = await showDialog({
    title: "No PDF found",
    message: findMissMessage(paper.title, miss),
    severity: "warning",
    buttons: [{ id: "attach", label: "Attach PDF…" }, { id: "retry", label: "Search again", primary: true }],
  });
  if (choice === "attach") attachLocalPdf(store, paper);
  else if (choice === "retry") await findPdfFor(store, paper);
}

/**
 * Opens a local file picker and attaches the chosen PDF to the paper. The
 * picker is clicked synchronously inside the user gesture (handleAction awaits
 * nothing before the switch), so the browser allows it; the file is read and
 * validated afterwards. PDF bytes are never sent through runtime messaging —
 * the page writes IndexedDB itself via attachPdfToPaper.
 */
function attachLocalPdf(store: LibraryStore, paper: PaperRecord): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,application/pdf";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void ingestLocalPdf(store, paper, file).catch((err: unknown) => toast(errorMessage(err), "error"));
  });
  input.click();
}

async function ingestLocalPdf(store: LibraryStore, paper: PaperRecord, file: File): Promise<void> {
  if (file.size > MAX_PDF_BYTES) {
    toast("That file is larger than 120 MB.", "error");
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdfBytes(bytes)) {
    toast("That file does not look like a PDF.", "error");
    return;
  }
  // attachPdfToPaper re-reads the record's current path, so a move during the
  // pick cannot orphan the file, and refuses to overwrite a PDF that arrived by sync.
  const { written } = await attachPdfToPaper(paper.id, bytes);
  await refreshLibrary(store);
  if (written) {
    scheduleSyncSoon("paper.attach");
    toast("PDF attached", "ok");
  } else {
    toast("This paper already has a PDF.", "info");
  }
}

async function copyCite(paper: PaperRecord): Promise<void> {
  try {
    await navigator.clipboard.writeText(paper.citeKey);
    toast(`Copied: ${paper.citeKey}`, "ok");
  } catch (err) {
    toast(`Clipboard blocked — ${errorMessage(err)}`, "error");
  }
}

async function setStatus(store: LibraryStore, ids: string[], status: PaperStatus): Promise<void> {
  const byId = new Map(store.get().papers.map((p) => [p.id, p]));
  const changed = ids.map((id) => byId.get(id)).filter((p): p is PaperRecord => !!p && p.status !== status);
  if (changed.length === 0) return;
  // Applied locally first so the row responds instantly; IDB confirms right after.
  store.set({ papers: store.get().papers.map((p) => (changed.includes(p) ? { ...p, status } : p)) });
  for (const paper of changed) {
    const next: PaperRecord = { ...paper, status };
    await upsertRecord(next, next.path);
    await bib.writePaperArtifacts(next.path, next, "paper.pdf");
  }
  await refreshLibrary(store);
  scheduleSyncSoon("paper.status");
}

async function deletePapers(store: LibraryStore, papers: PaperRecord[]): Promise<void> {
  const title = papers.length === 1 ? `Remove "${papers[0]!.title}" from the library?` : `Remove ${papers.length} papers from the library?`;
  // Do not claim a PDF is deleted when none of the selected papers has one.
  const pdfDirs = store.get().pdfDirs;
  const anyPdf = papers.some((p) => pdfDirs.has(p.path));
  const message = anyPdf
    ? "The PDF and its metadata are deleted from this browser. The next sync removes them from Google Drive and from the VS Code extension."
    : "The metadata is deleted from this browser. The next sync removes it from Google Drive and from the VS Code extension.";
  const choice = await showDialog({
    title,
    message,
    severity: "danger",
    buttons: [{ id: "remove", label: "Remove", primary: true, danger: true }],
  });
  if (choice !== "remove") return;
  for (const paper of papers) {
    await deleteRecord(paper.id);
    await fs.deleteDir(paper.path);
  }
  store.clearSelection();
  await refreshLibrary(store);
  scheduleSyncSoon("paper.delete");
  toast(papers.length === 1 ? "Paper removed" : `${papers.length} papers removed`, "ok");
}

async function pickMoveTarget(store: LibraryStore, ids: string[]): Promise<void> {
  const items = [{ label: ROOT_LABEL, path: ROOT }, ...flattenFolders(store.get().folders)]
    .map((f) => ({ label: f.label, icon: (f.path === ROOT ? "library" : "folder") as "library" | "folder", value: f.path }));
  const target = await quickPick(items, { placeholder: `Move ${ids.length === 1 ? "paper" : `${ids.length} papers`} to…` });
  if (target) await movePapers(store, ids, target);
}

/** Moves paper folders under `target` and re-points their records; papers already there are skipped. */
export async function movePapers(store: LibraryStore, ids: string[], target: string): Promise<void> {
  const byId = new Map(store.get().papers.map((p) => [p.id, p]));
  let moved = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const paper = byId.get(id);
    if (!paper || parentDir(paper.path) === target) continue;
    const destination = `${target}/${baseName(paper.path)}`;
    if (await fs.stat(destination)) { failed.push(`"${paper.title}" — a paper with the same key is already there`); continue; }
    await fs.moveDir(paper.path, destination);
    await folderService.relocatePapersUnder(paper.path, destination);
    moved++;
  }
  if (moved) { await refreshLibrary(store); scheduleSyncSoon("paper.move"); }
  const where = target === ROOT ? ROOT_LABEL : baseName(target);
  if (failed.length) toast(`${moved} moved, ${failed.length} failed — ${failed[0]}`, "error");
  else if (moved) toast(`${moved} paper${moved === 1 ? "" : "s"} moved to ${where}`, "ok");
}

/** Lists the window's other tabs in a quick pick and captures the chosen one. */
async function addFromOpenTab(store: LibraryStore): Promise<void> {
  const tabs = await send<TabSummary[]>({ type: "tabs.list" });
  if (tabs.length === 0) {
    toast("Open the paper's page in another tab first, then click Add again.", "info");
    return;
  }
  const items = tabs.map((t) => ({ label: t.title || t.url, description: hostOf(t.url), icon: "globe" as const, value: t.id }));
  const tabId = await quickPick(items, { title: "Add a paper from an open tab", placeholder: "Pick the tab showing the paper (DOI, arXiv or PDF page)" });
  if (tabId === undefined) return;
  // Like the VS Code "Add Paper Here", the import lands in the folder being viewed.
  await captureTab(store, tabId, store.get().folder, "ask", false);
}

/**
 * Sends capture.tab and reacts to the outcome: a save that found no PDF asks
 * before writing (nothing is written until confirmed); an "already in library"
 * reply selects the existing copy without duplicating it (fixes D4).
 */
async function captureTab(store: LibraryStore, tabId: number, targetFolder: string, ifNoPdf: IfNoPdf, retryPdf: boolean): Promise<void> {
  const dismiss = toast(retryPdf ? "Searching for the PDF…" : "Capturing paper…", "info");
  let result: SaveOutcome;
  try {
    result = await send<SaveOutcome>({ type: "capture.tab", tabId, targetFolder, ifNoPdf, ...(retryPdf ? { retryPdf } : {}) });
  } finally {
    dismiss();
  }

  if (result.status === "no-pdf") {
    const choice = await showDialog({
      ...noPdfDialogCopy(result.title, result.miss),
      severity: "warning",
      buttons: [{ id: "retry", label: "Search again" }, { id: "save", label: "Save without PDF", primary: true }],
    });
    if (choice === "save") await captureTab(store, tabId, targetFolder, "save", false);
    else if (choice === "retry") await captureTab(store, tabId, targetFolder, "ask", true);
    return;                                                 // Cancel: nothing was written
  }

  await refreshLibrary(store);
  store.selectOnly(result.id);
  if (result.alreadyInLibrary) {
    toast(`Already in your library — "${result.title}"`, "info");
  } else {
    toast(result.pdfSource ? `Added "${result.title}" (PDF via ${pdfSourceLabel(result.pdfSource)})` : `Added "${result.title}" — saved without a PDF`, "ok");
  }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}
