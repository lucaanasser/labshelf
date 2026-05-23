/**
 * Options page logic. Loads persisted settings, exposes save handlers for sync
 * and PDF-resolution preferences (including the Sci-Hub fallback toggle),
 * mirrors the Drive connection state with a disconnect button, and renders the
 * recent log buffer at the bottom.
 * @depends platform/browserApi, platform/logger, platform/settings,
 *          platform/runtimeMessages
 * @dependents options/index.html
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import { getSettings, updateSettings } from "../platform/settings";
import type { LabShelfSettings } from "../platform/settings";
import type { RuntimeMessage, RuntimeResponse } from "../platform/runtimeMessages";

const logger = new BrowserLogger("options");

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function flash(target: HTMLElement, text: string): void {
  target.textContent = text;
  setTimeout(() => { target.textContent = ""; }, 2500);
}

async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

async function loadIntoForm(): Promise<void> {
  const s = await getSettings();
  ($("sync-interval") as HTMLInputElement).value = String(s.autoSyncMinutes);
  ($("contact-email") as HTMLInputElement).value = s.contactEmail;
  ($("enable-scihub") as HTMLInputElement).checked = s.enableSciHub;
  ($("scihub-mirror") as HTMLInputElement).value = s.sciHubMirror;
}

async function saveSync(): Promise<void> {
  const patch: Partial<LabShelfSettings> = {
    autoSyncMinutes: Math.max(0, Number(($("sync-interval") as HTMLInputElement).value) || 0),
    contactEmail: ($("contact-email") as HTMLInputElement).value.trim() || "contact@labshelf.dev",
  };
  await updateSettings(patch);
  await logger.info("sync settings saved", patch as Record<string, unknown>);
  flash($("save-sync-msg"), "SAVED");
}

async function savePdf(): Promise<void> {
  const mirror = ($("scihub-mirror") as HTMLInputElement).value.trim() || "https://sci-hub.se";
  const patch: Partial<LabShelfSettings> = {
    enableSciHub: ($("enable-scihub") as HTMLInputElement).checked,
    sciHubMirror: mirror.replace(/\/+$/, ""),
  };
  await updateSettings(patch);
  await logger.info("pdf settings saved", patch as Record<string, unknown>);
  flash($("save-pdf-msg"), "SAVED");
}

async function renderConnection(): Promise<void> {
  const status = $("connection-status");
  const btn = $("disconnect") as HTMLButtonElement;
  try {
    const { connected } = await send<{ connected: boolean }>({ type: "auth.status" });
    status.textContent = connected ? "CONNECTED · TOKEN STORED LOCALLY" : "DISCONNECTED";
    btn.disabled = !connected;
  } catch (err) {
    status.textContent = `ERROR · ${err instanceof Error ? err.message : String(err)}`;
    btn.disabled = true;
  }
}

async function disconnect(): Promise<void> {
  const btn = $("disconnect") as HTMLButtonElement;
  btn.disabled = true;
  try {
    await send<{ connected: boolean }>({ type: "auth.disconnect" });
    await logger.info("disconnected from Drive via options page");
    await renderConnection();
    flash($("disconnect-msg"), "DISCONNECTED");
  } catch (err) {
    flash($("disconnect-msg"), `ERROR · ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btn.disabled = false;
  }
}

async function renderLog(): Promise<void> {
  const target = document.getElementById("log");
  if (!target) return;
  const entries = await logger.recent();
  if (entries.length === 0) {
    target.textContent = "(NO LOG ENTRIES YET)";
    return;
  }
  target.textContent = entries
    .map((e) => `${e.timestamp} [${e.level.toUpperCase()}] (${e.module}) ${e.message}`)
    .join("\n");
}

async function init(): Promise<void> {
  await loadIntoForm();
  ($("save-sync") as HTMLButtonElement).addEventListener("click", () => { void saveSync(); });
  ($("save-pdf") as HTMLButtonElement).addEventListener("click", () => { void savePdf(); });
  ($("disconnect") as HTMLButtonElement).addEventListener("click", () => { void disconnect(); });
  await renderConnection();
  await renderLog();
}

void init();
