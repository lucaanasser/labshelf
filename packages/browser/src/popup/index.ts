/**
 * Popup bootstrap. One job: save the paper on this tab. It shows what was
 * recognised (title, authors · venue · year, whether the PDF was found),
 * lets the user pick the folder and add tags and a note, and saves. Sync,
 * the library and settings are icon buttons in the header; Drive connection
 * lives on the options page.
 *
 * States (data-state on #popup): loading → form (a paper, not yet saved) |
 * library (already saved) | empty (no paper here) → saving → saved. A paper
 * whose PDF the search cannot reach is never written silently: the user is
 * asked first through the shared "No PDF found" dialog.
 * @depends platform/browserApi, platform/runtimeMessages, ui/dom, ui/icons, ui/theme, ui/dialog, ui/pdfCopy, popup/format
 * @dependents popup/index.html
 */
import { bx } from "../platform/browserApi";
import type {
  AttachPdfData, DraftView, FoldersData, IfNoPdf, LibraryRef, PdfMiss, PdfStatusData,
  RuntimeMessage, RuntimeResponse, SaveOutcome, SavedPaperData, SyncStatusData,
} from "../platform/runtimeMessages";
import { $, esc, shortTime } from "../ui/dom";
import { icon } from "../ui/icons";
import { applyTheme } from "../ui/theme";
import { showDialog } from "../ui/dialog";
import { noPdfDialogCopy } from "../ui/pdfCopy";
import { folderName, metaLine, parseTags } from "./format";
import { pdfLineText, pdfSourceLabel } from "../ui/pdfCopy";
import { PAPERS_DIR } from "@labshelf/core";

type PopupState = "loading" | "form" | "library" | "empty" | "saving" | "saved";

async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

let tabId = -1;
let folders: FoldersData = { folders: [{ path: PAPERS_DIR, label: "Library", depth: 0 }], lastFolder: PAPERS_DIR };
let saved: SavedPaperData | undefined;
let pdfStatus: PdfStatusData | undefined;

function setState(state: PopupState): void {
  $("popup").dataset["state"] = state;
  $("form").hidden = !(state === "form" || state === "saving");
  $("status").hidden = !(state === "library" || state === "empty" || state === "saved");
  const busy = state === "saving";
  for (const id of ["folder", "tags", "note", "save"]) $<HTMLInputElement>(id).disabled = busy;
  // While searching, pdfStatus is undefined; Save then waits on the search.
  $("save").innerHTML = busy
    ? `<span class="spin">${icon("sync")}</span><span>${pdfStatus ? "Saving…" : "Looking for the PDF…"}</span>`
    : `<span>Save to LabShelf</span>`;
}

function showStatus(opts: { glyph: string; tone: "ok" | "muted" | "warn"; title: string; detail: string; open?: string; attach?: string; undo?: boolean; tryAnyway?: boolean }): void {
  const glyph = $("statusIcon");
  glyph.innerHTML = icon(opts.glyph);
  glyph.dataset["tone"] = opts.tone;
  $("statusTitle").textContent = opts.title;
  $("statusDetail").textContent = opts.detail;
  $("statusDetail").hidden = !opts.detail;
  const open = $<HTMLButtonElement>("open");
  open.hidden = !opts.open;
  open.innerHTML = `${icon("library")}<span>${esc(opts.open ?? "")}</span>`;
  const attach = $<HTMLButtonElement>("attachPdf");
  attach.hidden = !opts.attach;
  attach.innerHTML = `${icon("paperclip")}<span>${esc(opts.attach ?? "")}</span>`;
  $("undo").hidden = !opts.undo;
  $("tryAnyway").hidden = !opts.tryAnyway;
}

function renderPaper(d: DraftView): void {
  $("title").textContent = d.title || "Untitled";
  $("title").classList.remove("muted");
  $("meta").textContent = metaLine(d);
}

function renderPdf(status: PdfStatusData | "searching"): void {
  const el = $("pdf");
  el.hidden = false;
  if (status === "searching") {
    el.dataset["tone"] = "muted";
    el.innerHTML = `<span class="spin">${icon("sync")}</span><span>${esc(pdfLineText("searching"))}</span>`;
  } else if (status.found) {
    el.dataset["tone"] = "ok";
    el.innerHTML = `${icon("file-text")}<span>${esc(pdfLineText(status))}</span>`;
  } else {
    el.dataset["tone"] = "warn";
    el.innerHTML = `${icon("warning")}<span>${esc(pdfLineText(status))}</span>`;
  }
}

function renderFolders(): void {
  const select = $<HTMLSelectElement>("folder");
  select.innerHTML = "";
  for (const f of folders.folders) {
    const option = document.createElement("option");
    option.value = f.path;
    // <option> cannot be indented, so nesting reads as a path ("Thesis / Chapter 2").
    option.textContent = folderName(f.path, folders);
    select.append(option);
  }
  select.value = folders.lastFolder;
}

function showLibraryCopy(existing: LibraryRef): void {
  setState("library");
  if (existing.hasPdf) {
    showStatus({ glyph: "check", tone: "ok", title: "Already in your library", detail: folderName(existing.folder, folders), open: "Open in library" });
  } else {
    showStatus({ glyph: "warning", tone: "warn", title: "In your library — without its PDF", detail: folderName(existing.folder, folders), open: "Open in library" });
  }
  $("open").dataset["folder"] = existing.folder;
  $("open").dataset["paper"] = existing.id;
}

// A paper already saved without its PDF: the background searches this very page
// for one, and the popup offers to attach it when found (Feature C).
async function showExisting(existing: LibraryRef): Promise<void> {
  showLibraryCopy(existing);
  if (existing.hasPdf) return;
  renderPdf("searching");
  try {
    pdfStatus = await send<PdfStatusData>({ type: "capture.findPdf", tabId });
  } catch {
    $("pdf").hidden = true;
    return;
  }
  if (pdfStatus.found) {
    renderPdf(pdfStatus);
    showStatus({
      glyph: "warning", tone: "warn", title: "In your library — without its PDF",
      detail: folderName(existing.folder, folders), open: "Open in library", attach: "Attach PDF",
    });
  } else {
    $("pdf").hidden = true;
    showStatus({
      glyph: "warning", tone: "warn", title: "In your library — without its PDF",
      detail: "No PDF on this page either — attach a file from the library.", open: "Open in library",
    });
  }
  $("open").dataset["folder"] = existing.folder;
  $("open").dataset["paper"] = existing.id;
}

async function inspect(): Promise<void> {
  const draft = await send<DraftView>({ type: "capture.inspect", tabId });
  renderPaper(draft);
  if (draft.existing) {
    await showExisting(draft.existing);
    return;
  }
  if (!draft.isPaper) {
    $("meta").textContent = "";
    setState("empty");
    showStatus({
      glyph: "globe", tone: "muted", title: "No paper detected on this page",
      detail: "Open the article's page or its PDF, or use the LabShelf buttons on Google Scholar.", tryAnyway: true,
    });
    return;
  }
  setState("form");
  $("save").focus();
  renderPdf("searching");
  try {
    pdfStatus = await send<PdfStatusData>({ type: "capture.findPdf", tabId });
    renderPdf(pdfStatus);
  } catch {
    $("pdf").hidden = true;
  }
}

// The shared "No PDF found" dialog. Returns the chosen action, or undefined on
// Cancel (nothing is written). The modal-open class guards the popup height.
async function confirmNoPdf(title: string, miss: PdfMiss): Promise<"save" | "retry" | undefined> {
  document.body.classList.add("modal-open");
  try {
    return await showDialog<"save" | "retry">({
      ...noPdfDialogCopy(title, miss),
      severity: "warning",
      buttons: [{ id: "retry", label: "Search again" }, { id: "save", label: "Save without PDF", primary: true }],
    });
  } finally {
    document.body.classList.remove("modal-open");
  }
}

async function confirmThen(title: string, miss: PdfMiss, from: string | undefined): Promise<void> {
  const choice = await confirmNoPdf(title, miss);
  if (choice === undefined) return;                // Cancel: nothing was written
  if (choice === "retry") {
    pdfStatus = undefined;
    if (from !== "empty") setState("form");
    renderPdf("searching");
    return save("ask", true);
  }
  return save("save");
}

async function save(ifNoPdf: IfNoPdf = "ask", retryPdf = false): Promise<void> {
  const from = $("popup").dataset["state"];

  // Case A: the search already ended with no PDF before Save was pressed — ask
  // instantly, with no round trip, and let Cancel keep the form as it is. The
  // background always carries `miss` on a miss; if it is absent, fall through to
  // the round trip, whose NoPdfData carries it.
  if (ifNoPdf === "ask" && !retryPdf && pdfStatus && !pdfStatus.found && pdfStatus.miss) {
    return confirmThen($("title").textContent ?? "", pdfStatus.miss, from);
  }

  $("error").hidden = true;
  setState("saving");
  try {
    const tags = parseTags($<HTMLInputElement>("tags").value);
    const note = $<HTMLTextAreaElement>("note").value.trim();
    const r = await send<SaveOutcome>({
      type: "capture.save", tabId, folder: $<HTMLSelectElement>("folder").value, ifNoPdf,
      ...(tags.length ? { tags } : {}), ...(note ? { note } : {}), ...(retryPdf ? { retryPdf } : {}),
    });
    if (r.status === "no-pdf") {
      // Case B: Save was pressed while the search was still running; it has now
      // ended empty. Nothing was written — ask before anything is.
      pdfStatus = { found: false, miss: r.miss };
      setState(from === "empty" ? "empty" : "form");
      renderPdf(pdfStatus);
      return confirmThen(r.title, r.miss, from);
    }
    saved = r;
    setState("saved");
    $("pdf").hidden = true;
    showStatus({
      glyph: "check", tone: "ok", title: `Saved to ${folderName(saved.folder, folders)}`,
      detail: saved.pdfSource ? `PDF via ${pdfSourceLabel(saved.pdfSource)} · syncs shortly` : "Saved without a PDF · syncs shortly",
      open: "Open in library", undo: true,
    });
    $("open").dataset["folder"] = saved.folder;
    $("open").dataset["paper"] = saved.id;
  } catch (err) {
    if (from === "empty") {
      setState("empty");
      showStatus({ glyph: "warning", tone: "muted", title: "Nothing could be saved", detail: errorText(err) });
    } else {
      setState("form");
      showError(errorText(err));
    }
  }
}

// Popup "Attach PDF" on a library copy that had none: the background attaches
// the PDF it found for this page to that copy.
async function attachPdf(): Promise<void> {
  const btn = $<HTMLButtonElement>("attachPdf");
  btn.disabled = true;
  try {
    const r = await send<AttachPdfData>({ type: "capture.attachPdf", tabId });
    $("pdf").hidden = true;
    if (r.attached) {
      showStatus({ glyph: "check", tone: "ok", title: "PDF attached", detail: `via ${pdfSourceLabel(r.source)} · syncs shortly`, open: "Open in library" });
    } else if (r.alreadyHadPdf) {
      showStatus({ glyph: "check", tone: "ok", title: "Already has its PDF", detail: "", open: "Open in library" });
    } else {
      showStatus({ glyph: "warning", tone: "warn", title: "No PDF found", detail: "No PDF could be downloaded for this paper.", open: "Open in library" });
    }
  } catch (err) {
    showStatus({ glyph: "warning", tone: "warn", title: "Could not attach the PDF", detail: errorText(err), open: "Open in library" });
  } finally {
    btn.disabled = false;
  }
}

function showError(message: string): void {
  const el = $("error");
  el.innerHTML = `${icon("warning")}<span></span>`;
  el.querySelector("span")!.textContent = message;
  el.hidden = false;
}

async function undo(): Promise<void> {
  if (!saved) return;
  $<HTMLButtonElement>("undo").disabled = true;
  try {
    await send({ type: "paper.remove", id: saved.id });
    saved = undefined;
    setState("form");
    if (pdfStatus) renderPdf(pdfStatus);
  } catch (err) {
    showStatus({ glyph: "warning", tone: "muted", title: "Could not remove the paper", detail: errorText(err), open: "Open in library" });
  } finally {
    $<HTMLButtonElement>("undo").disabled = false;
  }
}

// Header sync button: state at a glance; click syncs, or opens settings to connect.
async function renderSync(): Promise<void> {
  const btn = $<HTMLButtonElement>("sync");
  try {
    const [auth, sync] = await Promise.all([
      send<{ connected: boolean }>({ type: "auth.status" }),
      send<SyncStatusData>({ type: "sync.status" }),
    ]);
    btn.classList.toggle("spinning", sync.syncing);
    btn.dataset["tone"] = sync.lastError ? "error" : "";
    if (!auth.connected) {
      btn.innerHTML = icon("cloud-off");
      btn.title = "Not syncing — connect Google Drive in Settings";
      btn.dataset["action"] = "connect";
    } else {
      btn.innerHTML = icon(sync.syncing ? "sync" : sync.lastError ? "warning" : "cloud");
      btn.title = sync.syncing ? "Syncing…"
        : sync.lastError ? `Sync failed — ${sync.lastError}. Click to retry.`
        : `Synced with Google Drive${sync.lastSyncTime ? ` ${shortTime(sync.lastSyncTime)}` : ""}. Click to sync now.`;
      btn.dataset["action"] = "sync";
    }
  } catch {
    btn.innerHTML = icon("cloud-off");
    btn.title = "Background unavailable";
  }
}

function autoGrow(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  area.style.height = `${Math.min(area.scrollHeight, 96)}px`;
}

function wire(): void {
  $("form").addEventListener("submit", (e) => { e.preventDefault(); void save(); });
  const note = $<HTMLTextAreaElement>("note");
  note.addEventListener("input", () => autoGrow(note));
  note.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
  });
  $("tryAnyway").addEventListener("click", () => { void save(); });
  $("attachPdf").addEventListener("click", () => { void attachPdf(); });
  $("undo").addEventListener("click", () => { void undo(); });
  $("open").addEventListener("click", () => {
    const { folder, paper } = $("open").dataset;
    void send({ type: "library.open", ...(folder ? { folder } : {}), ...(paper ? { paperId: paper } : {}) }).then(() => window.close());
  });
  $("library").addEventListener("click", () => {
    void send({ type: "library.open" }).then(() => window.close());
  });
  $("settings").addEventListener("click", () => { void bx.runtime.openOptionsPage(); window.close(); });
  $("sync").addEventListener("click", () => {
    if ($("sync").dataset["action"] === "sync") {
      void send({ type: "sync.now" }).then(renderSync).then(() => setTimeout(() => { void renderSync(); }, 4000));
    } else {
      void bx.runtime.openOptionsPage();
      window.close();
    }
  });
}

async function init(): Promise<void> {
  applyTheme();
  $("brand").innerHTML = `${icon("logo")}<span>LabShelf</span>`;
  $("library").innerHTML = icon("library");
  $("settings").innerHTML = icon("gear");
  $("folderIcon").innerHTML = icon("folder");
  $("folderChevron").innerHTML = icon("chevron-down");
  $("tagsIcon").innerHTML = icon("tag");
  $("noteIcon").innerHTML = icon("message");
  $("undo").innerHTML = icon("trash");
  $("title").classList.add("muted");
  setState("loading");
  wire();
  void renderSync();

  const [tab] = await bx.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) {
    $("title").textContent = "Nothing to save here";
    setState("empty");
    showStatus({ glyph: "globe", tone: "muted", title: "This page can't be saved", detail: "Open an article's page or its PDF in a normal tab." });
    return;
  }
  tabId = tab.id;

  const foldersReady = send<FoldersData>({ type: "library.folders" })
    .then((f) => { folders = f; })
    .catch(() => undefined)
    .then(renderFolders);
  try {
    await Promise.all([foldersReady, inspect()]);
  } catch (err) {
    $("title").textContent = tab.title || "This page";
    setState("empty");
    showStatus({ glyph: "warning", tone: "muted", title: "Could not read this page", detail: errorText(err), tryAnyway: true });
  }
}

void init();
