/**
 * Settings page logic. Loads persisted settings into the form and autosaves
 * every change (debounced, with a "Saved" flag) — the VS Code settings
 * editor has no Save button either. Mirrors the Drive connection state with
 * connect / sync / disconnect actions, edits the PDF reader preferences (the
 * browser twin of VS Code's labshelf.reader.* settings), exposes the theme
 * preference shared by every surface, and renders the recent log buffer.
 *
 * @depends platform/browserApi, platform/logger, platform/settings, platform/runtimeMessages, reader/readerPrefsStore,
 *          ui/dom, ui/icons, ui/theme, @labshelf/reader (ReaderPrefs)
 * @dependents options/index.html
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import { getSettings, updateSettings } from "../platform/settings";
import type { LabShelfSettings } from "../platform/settings";
import type { RuntimeMessage, RuntimeResponse, SyncStatusData } from "../platform/runtimeMessages";
import { $, el, esc } from "../ui/dom";
import { icon } from "../ui/icons";
import { applyTheme, getThemePref, onThemeChange, setThemePref } from "../ui/theme";
import type { CitationStyle, ReaderPrefs, ZoomPreset } from "@labshelf/reader";
import { loadReaderPrefs, saveReaderPrefs } from "../reader/readerPrefsStore";
import type { ThemePref } from "../ui/theme";

const logger = new BrowserLogger("options");
const SAVE_DEBOUNCE_MS = 400;
const DEFAULT_MIRROR = "https://sci-hub.se";

async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

let savedTimer: ReturnType<typeof setTimeout> | null = null;
function flashSaved(): void {
  const flag = $("savedFlag");
  flag.innerHTML = `${icon("check")}<span>Saved</span>`;
  flag.classList.add("show");
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => flag.classList.remove("show"), 2000);
}

// ── form ────────────────────────────────────────────────────────────────────
function readForm(): Partial<LabShelfSettings> {
  const mirror = $<HTMLInputElement>("scihub-mirror").value.trim() || DEFAULT_MIRROR;
  return {
    autoSyncMinutes: Math.min(240, Math.max(0, Number($<HTMLInputElement>("sync-interval").value) || 0)),
    contactEmail: $<HTMLInputElement>("contact-email").value.trim() || "contact@labshelf.dev",
    enableSciHub: $<HTMLInputElement>("enable-scihub").checked,
    sciHubMirror: mirror.replace(/\/+$/, ""),
  };
}

async function loadIntoForm(): Promise<void> {
  const s = await getSettings();
  $<HTMLInputElement>("sync-interval").value = String(s.autoSyncMinutes);
  $<HTMLInputElement>("contact-email").value = s.contactEmail;
  $<HTMLInputElement>("enable-scihub").checked = s.enableSciHub;
  $<HTMLInputElement>("scihub-mirror").value = s.sciHubMirror;
  $("mirrorSetting").classList.toggle("disabled", !s.enableSciHub);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  $("mirrorSetting").classList.toggle("disabled", !$<HTMLInputElement>("enable-scihub").checked);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void (async () => {
      const patch = readForm();
      await updateSettings(patch);
      await logger.info("settings saved", patch as Record<string, unknown>);
      flashSaved();
    })();
  }, SAVE_DEBOUNCE_MS);
}

// ── PDF reader ──────────────────────────────────────────────────────────────
const READER_FIELDS = ["reader-default-zoom", "reader-restore-position", "reader-toolbar-autohide", "reader-hover-previews", "reader-hover-delay", "reader-citation-style", "reader-vim-keys"];

function readReaderForm(): Partial<ReaderPrefs> {
  return {
    defaultZoom: $<HTMLSelectElement>("reader-default-zoom").value as ZoomPreset,
    restorePosition: $<HTMLInputElement>("reader-restore-position").checked,
    toolbarAutoHide: $<HTMLInputElement>("reader-toolbar-autohide").checked,
    hoverPreviews: $<HTMLInputElement>("reader-hover-previews").checked,
    hoverDelayMs: Number($<HTMLInputElement>("reader-hover-delay").value),
    citationStyle: $<HTMLSelectElement>("reader-citation-style").value as CitationStyle,
    vimKeys: $<HTMLInputElement>("reader-vim-keys").checked,
  };
}

function fillReaderForm(p: ReaderPrefs): void {
  $<HTMLSelectElement>("reader-default-zoom").value = p.defaultZoom;
  $<HTMLInputElement>("reader-restore-position").checked = p.restorePosition;
  $<HTMLInputElement>("reader-toolbar-autohide").checked = p.toolbarAutoHide;
  $<HTMLInputElement>("reader-hover-previews").checked = p.hoverPreviews;
  $<HTMLInputElement>("reader-hover-delay").value = String(p.hoverDelayMs);
  $<HTMLSelectElement>("reader-citation-style").value = p.citationStyle;
  $<HTMLInputElement>("reader-vim-keys").checked = p.vimKeys;
  $("hoverDelaySetting").classList.toggle("disabled", !p.hoverPreviews);
}

let readerSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReaderSave(): void {
  $("hoverDelaySetting").classList.toggle("disabled", !$<HTMLInputElement>("reader-hover-previews").checked);
  if (readerSaveTimer) clearTimeout(readerSaveTimer);
  readerSaveTimer = setTimeout(() => {
    void (async () => {
      // Normalized on save: an out-of-range delay is clamped, and the form shows what was stored.
      const saved = await saveReaderPrefs(readReaderForm());
      if (document.activeElement?.id !== "reader-hover-delay") fillReaderForm(saved);
      await logger.info("reader preferences saved", saved as unknown as Record<string, unknown>);
      flashSaved();
    })();
  }, SAVE_DEBOUNCE_MS);
}

// ── Drive connection ────────────────────────────────────────────────────────
async function renderConnection(): Promise<void> {
  const status = $("connection");
  const actions = $("connectionActions");
  try {
    const s = await send<SyncStatusData>({ type: "sync.status" });
    const state = s.syncing ? "Syncing…" : s.connected
      ? (s.lastSyncTime ? `Connected — last sync ${new Date(s.lastSyncTime).toLocaleString()}` : "Connected to Google Drive")
      : "Not connected to Google Drive";
    status.innerHTML = `<span class="ls-dot ${s.lastError ? "s-error" : s.connected ? "s-ok" : ""}"></span><span>${esc(state)}</span>` +
      (s.lastError ? `<span style="color:var(--ls-error)"> — ${esc(s.lastError)}</span>` : "");
    actions.replaceChildren(...(s.connected
      ? [button("Sync now", "sync", "sync.now", false), button("Disconnect", "cloud-off", "auth.disconnect", false)]
      : [button("Connect to Google Drive", "cloud", "auth.connect", true)]));
  } catch (err) {
    status.innerHTML = `<span class="ls-dot s-error"></span><span>Background unavailable — ${esc(err instanceof Error ? err.message : String(err))}</span>`;
    actions.replaceChildren();
  }
}

function button(label: string, glyph: string, type: "sync.now" | "auth.connect" | "auth.disconnect", primary: boolean): HTMLButtonElement {
  const b = el("button", { class: `ls-btn${primary ? " ls-btn-primary" : ""}`, type: "button", html: `${icon(glyph)}<span>${esc(label)}</span>` });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await send({ type });
      await logger.info(`${type} via options page`);
    } catch (err) {
      await logger.error("options", err, { op: type });
    } finally {
      await renderConnection();
      await renderLog();
    }
  });
  return b;
}

// ── theme ───────────────────────────────────────────────────────────────────
function renderThemeSeg(current: ThemePref): void {
  const seg = $("themeSeg");
  const options: Array<[ThemePref, string, string]> = [["auto", "System", "globe"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]];
  seg.replaceChildren(...options.map(([pref, label, glyph]) => {
    const b = el("button", { class: current === pref ? "on" : "", type: "button", role: "radio", "aria-checked": String(current === pref), html: `${icon(glyph)}<span>${label}</span>` });
    b.addEventListener("click", () => { setThemePref(pref); flashSaved(); });
    return b;
  }));
}

// ── log ─────────────────────────────────────────────────────────────────────
async function renderLog(): Promise<void> {
  const entries = await logger.recent();
  $("log").textContent = entries.length === 0
    ? "No log entries yet."
    : entries.map((e) => `${e.timestamp} [${e.level.toUpperCase()}] (${e.module}) ${e.message}`).join("\n");
}

async function init(): Promise<void> {
  applyTheme();
  $("brand").innerHTML = `${icon("logo")}<span>LabShelf</span>`;
  await loadIntoForm();
  fillReaderForm(await loadReaderPrefs());
  for (const id of READER_FIELDS) {
    $(id).addEventListener("input", scheduleReaderSave);
    $(id).addEventListener("change", scheduleReaderSave);
  }
  for (const id of ["sync-interval", "contact-email", "enable-scihub", "scihub-mirror"]) {
    $(id).addEventListener("input", scheduleSave);
    $(id).addEventListener("change", scheduleSave);
  }
  onThemeChange((_theme, pref) => renderThemeSeg(pref));
  renderThemeSeg(getThemePref());
  await renderConnection();
  await renderLog();
}

void init();
