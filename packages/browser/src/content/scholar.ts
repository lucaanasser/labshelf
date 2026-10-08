/**
 * Google Scholar content script: puts a "Save to LabShelf" split button under
 * each result's right-hand links (where Scholar shows "[PDF] host"), the way
 * reference managers do. The main part saves into the last-used folder; the
 * chevron opens the kit's menu to pick another one. Results already in the
 * library show "In LabShelf" (green mark) and open the paper in the library.
 *
 * The button is the extension's own design (--ls-* tokens, VS Code split
 * button: brand mark, label, separator, chevron) rendered in a shadow root,
 * so Scholar's stylesheet cannot reshape it. All work happens in the
 * background (scholar.save); this script reads the result, renders state and
 * survives Scholar re-rendering its result list. When the search finds no PDF,
 * the user is asked first (shared "No PDF found" dialog, in the overlay shadow
 * root); a result saved without a PDF reads distinctly, not as complete.
 * @depends platform/browserApi, platform/runtimeMessages, content/scholarParse, content/shadowStyles, ui/icons, ui/menu, ui/dialog, ui/pdfCopy
 * @dependents manifest content_scripts (scholar.google.*)
 */
import { bx } from "../platform/browserApi";
import type { FoldersData, IfNoPdf, LookupData, RuntimeMessage, RuntimeResponse, SaveOutcome, ScholarHit } from "../platform/runtimeMessages";
import { icon } from "../ui/icons";
import { showDialog } from "../ui/dialog";
import { closeMenu, showMenu } from "../ui/menu";
import { noPdfDialogCopy, pdfSourceLabel } from "../ui/pdfCopy";
import { isScholarUrl, lookupItemFor, readResult } from "./scholarParse";
import { kitShadow } from "./shadowStyles";

type ButtonState = "idle" | "saving" | "saved" | "error" | "confirm";

interface Mounted {
  hit: ScholarHit;
  box: HTMLElement;
  main: HTMLButtonElement;
  caret: HTMLButtonElement;
  saved?: { folder: string; id: string; hasPdf: boolean };
}

const MOUNTED_ATTR = "data-lsx";
const mounted = new Map<string, Mounted>();
let overlay: ShadowRoot | undefined;

// A VS Code split button on the kit's secondary-button colours.
const BUTTON_CSS = `
.lsx { display: inline-flex; align-items: stretch; height: 24px; font-size: 12px; line-height: 16px; border-radius: var(--ls-radius); background: var(--ls-button2-bg); color: var(--ls-button2-fg); }
.lsx button { display: inline-flex; align-items: center; margin: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; transition: background var(--ls-fast); }
.lsx button:hover { background: var(--ls-button2-hover); }
.lsx-main { gap: 7px; padding: 0 10px 0 4px; border-radius: var(--ls-radius) 0 0 var(--ls-radius); white-space: nowrap; }
.lsx-caret { justify-content: center; width: 22px; padding: 0; border-radius: 0 var(--ls-radius) var(--ls-radius) 0; }
.lsx-caret svg { width: 14px; height: 14px; opacity: .8; }
.lsx-sep { width: 1px; margin: 5px 0; background: var(--ls-border-soft); }
.lsx-mark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0;
  border-radius: var(--ls-radius-sm); background: var(--ls-button-bg); color: var(--ls-button-fg); }
.lsx-mark svg { width: 11px; height: 11px; }
.lsx[data-state="saving"] .lsx-mark svg { animation: lsx-spin 1.2s linear infinite; }
.lsx[data-state="saving"] button { cursor: progress; }
.lsx[data-state="saved"] .lsx-mark { background: var(--ls-status-done); }
.lsx[data-state="saved"] .lsx-sep, .lsx[data-state="saved"] .lsx-caret { display: none; }
.lsx[data-state="saved"] .lsx-main { border-radius: var(--ls-radius); }
.lsx[data-state="error"] .lsx-mark { background: var(--ls-error); }
.lsx[data-state="confirm"] .lsx-mark { background: var(--ls-yellow); }
/* Saved without a PDF: a muted badge, not the green "done" mark. Placed after
   the saved rule so it wins at equal specificity. */
.lsx[data-pdf="none"] .lsx-mark { background: var(--ls-badge-bg); color: var(--ls-badge-fg); }
@keyframes lsx-spin { to { transform: rotate(360deg); } }
`;

const LABELS: Record<ButtonState, { glyph: string; text: string }> = {
  idle: { glyph: "logo", text: "Save to LabShelf" },
  saving: { glyph: "sync", text: "Finding PDF…" },
  saved: { glyph: "check", text: "In LabShelf" },
  error: { glyph: "warning", text: "Try again" },
  confirm: { glyph: "warning", text: "No PDF found" },
};

async function send<T>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

function setState(m: Mounted, state: ButtonState, title: string): void {
  m.box.dataset["state"] = state;
  const { glyph, text } = LABELS[state];
  m.main.innerHTML = `<span class="lsx-mark">${icon(glyph)}</span><span></span>`;
  m.main.querySelector("span:last-child")!.textContent = text;
  m.main.title = title;
  m.main.setAttribute("aria-label", title);
}

function markSaved(m: Mounted, ref: { folder: string; id: string; hasPdf: boolean }, detail: string): void {
  m.saved = ref;
  const title = ref.hasPdf
    ? `In your LabShelf library${detail ? ` — ${detail}` : ""}. Click to open it.`
    : "In your LabShelf library, but without a PDF — LabShelf found none. Click to open it; the library's Find PDF can retry.";
  setState(m, "saved", title);
  m.box.dataset["pdf"] = ref.hasPdf ? "" : "none";
  // A saved paper without its PDF reads distinctly, not as a complete capture.
  if (!ref.hasPdf) m.main.querySelector("span:last-child")!.textContent = "In LabShelf · no PDF";
}

async function save(m: Mounted, folder?: string, ifNoPdf: IfNoPdf = "ask", retryPdf = false): Promise<void> {
  const state = m.box.dataset["state"];
  if (state === "saving" || state === "confirm") return;
  setState(m, "saving", "Saving to LabShelf — looking for the PDF…");
  try {
    const r = await send<SaveOutcome>({
      type: "scholar.save", hit: m.hit,
      ...(folder ? { folder } : {}), ifNoPdf, ...(retryPdf ? { retryPdf } : {}),
    });
    if (r.status === "no-pdf") {
      // Nothing was written: ask before saving the reference without its PDF.
      setState(m, "confirm", "No PDF found — choose whether to save the reference without it.");
      const choice = await showDialog<"save" | "retry">({
        ...noPdfDialogCopy(m.hit.title, r.miss),
        severity: "warning",
        buttons: [{ id: "retry", label: "Search again" }, { id: "save", label: "Save without PDF", primary: true }],
        root: overlayRoot(),
      });
      if (choice === "save") return save(m, folder, "save");
      if (choice === "retry") return save(m, folder, "ask", true);
      setState(m, "idle", "Not saved — no PDF was found. Click to try again.");
      return;
    }
    const detail = r.alreadyInLibrary ? "it was already there" : r.pdfSource ? `PDF via ${pdfSourceLabel(r.pdfSource)}` : "saved without a PDF";
    markSaved(m, { folder: r.folder, id: r.id, hasPdf: r.hasPdf }, detail);
  } catch (err) {
    setState(m, "error", `Could not save: ${err instanceof Error ? err.message : String(err)}. Click to retry.`);
  }
}

function overlayRoot(): ShadowRoot {
  if (!overlay) {
    const host = document.createElement("div");
    host.setAttribute(MOUNTED_ATTR, "overlay");
    document.documentElement.append(host);
    overlay = kitShadow(host, "", "position: fixed; top: 0; left: 0; z-index: 2147483000;");
  }
  return overlay;
}

// "papers/Thesis/Chapter 2" → "Thesis / Chapter 2", as in the popup's folder select.
function folderLabel(path: string): string {
  const rel = path.replace(/^papers\/?/, "");
  return rel ? rel.split("/").join(" / ") : "Library";
}

async function openFolderMenu(m: Mounted): Promise<void> {
  let data: FoldersData;
  try {
    data = await send<FoldersData>({ type: "library.folders" });
  } catch {
    return;
  }
  showMenu(m.caret, data.folders.map((f) => ({
    label: folderLabel(f.path),
    icon: f.depth === 0 ? ("library" as const) : ("folder" as const),
    ...(f.path === data.lastFolder ? { hint: "last used" } : {}),
    onSelect: () => { void save(m, f.path); },
  })), { root: overlayRoot() });
}

function mount(result: Element): Mounted | undefined {
  if (result.hasAttribute(MOUNTED_ATTR)) return undefined;
  result.setAttribute(MOUNTED_ATTR, "1");
  const hit = readResult(result);
  if (!hit) return undefined;

  // Scholar's right column; results without a PDF link get one built the same way.
  let column = result.querySelector(".gs_ggs .gs_ggsd");
  if (!column) {
    const ggs = document.createElement("div");
    ggs.className = "gs_ggs gs_fl";
    column = document.createElement("div");
    column.className = "gs_ggsd";
    ggs.append(column);
    result.insertBefore(ggs, result.querySelector(".gs_ri"));
  }

  const host = document.createElement("div");
  column.append(host);
  const root = kitShadow(host, BUTTON_CSS, "display: block; margin: 8px 0 2px;");
  const box = document.createElement("div");
  box.className = "lsx";
  box.innerHTML =
    `<button class="lsx-main" type="button"></button>` +
    `<span class="lsx-sep" aria-hidden="true"></span>` +
    `<button class="lsx-caret" type="button" title="Save to a folder…" aria-label="Save to a folder" aria-haspopup="menu">${icon("chevron-down")}</button>`;
  root.append(box);

  const m: Mounted = { hit, box, main: box.querySelector(".lsx-main")!, caret: box.querySelector(".lsx-caret")! };
  setState(m, "idle", "Save to LabShelf, into the folder used last");
  m.main.addEventListener("click", (e) => {
    e.preventDefault();
    if (m.saved) void send({ type: "library.open", folder: m.saved.folder, paperId: m.saved.id });
    else void save(m);
  });
  m.caret.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const state = box.dataset["state"];
    if (state !== "saving" && state !== "confirm") void openFolderMenu(m);
  });
  mounted.set(hit.key, m);
  return m;
}

async function scan(): Promise<void> {
  const fresh = [...document.querySelectorAll(".gs_r.gs_or")].map(mount).filter((m): m is Mounted => !!m);
  if (!fresh.length) return;
  try {
    const known = await send<LookupData>({ type: "library.lookup", items: fresh.map((m) => lookupItemFor(m.hit)) });
    for (const [key, ref] of Object.entries(known)) {
      const m = mounted.get(key);
      if (m) markSaved(m, ref, "");
    }
  } catch {
    // The background is unavailable (extension reloading): buttons stay "Save to LabShelf".
  }
}

function start(): void {
  void scan();
  let pending: number | undefined;
  new MutationObserver(() => {
    window.clearTimeout(pending);
    pending = window.setTimeout(() => { void scan(); }, 200);
  }).observe(document.body, { childList: true, subtree: true });
  // Scholar navigating away from a page leaves no stray menu behind.
  window.addEventListener("pagehide", closeMenu);
}

if (isScholarUrl(location.href)) start();
