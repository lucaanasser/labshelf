/**
 * Popup bootstrap. Hooks the toolbar buttons to the background auth, sync, and
 * capture services. Renders in the terminal/brutalist aesthetic — uppercase
 * statuses, bracketed labels, and a footer status bar showing the last sync
 * time on the left and the last capture's PDF source on the right.
 * @depends platform/browserApi, platform/runtimeMessages
 * @dependents popup/index.html
 */
import { bx } from "../platform/browserApi";
import type {
  RuntimeMessage,
  RuntimeResponse,
  SyncStatusData,
  CaptureResultData,
} from "../platform/runtimeMessages";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

interface View {
  status: HTMLElement;
  syncStatus: HTMLElement;
  captureSource: HTMLElement;
  connectBtn: HTMLButtonElement;
  syncBtn: HTMLButtonElement;
  captureBtn: HTMLButtonElement;
  libraryBtn: HTMLButtonElement;
}

function setStatus(view: View, state: "idle" | "connected" | "error", text: string): void {
  view.status.dataset["state"] = state;
  view.status.textContent = text.toUpperCase();
}

function setConnected(view: View, connected: boolean): void {
  if (connected) {
    setStatus(view, "connected", "DRIVE SYNCED");
    view.connectBtn.textContent = "Disconnect Drive";
    view.syncBtn.disabled = false;
  } else {
    setStatus(view, "idle", "DISCONNECTED");
    view.connectBtn.textContent = "Connect to Drive";
    view.syncBtn.disabled = true;
  }
}

function renderSyncStatus(view: View, s: SyncStatusData): void {
  if (s.syncing) {
    view.syncStatus.textContent = "SYNCING…";
  } else if (s.lastError) {
    view.syncStatus.textContent = `SYNC ERR: ${s.lastError}`;
  } else if (s.lastSyncTime) {
    const t = new Date(s.lastSyncTime).toLocaleTimeString();
    view.syncStatus.textContent = `SYNCED ${t}`;
  } else {
    view.syncStatus.textContent = "";
  }
}

async function refresh(view: View): Promise<void> {
  const [auth, syncSt] = await Promise.all([
    send<{ connected: boolean }>({ type: "auth.status" }),
    send<SyncStatusData>({ type: "sync.status" }),
  ]);
  setConnected(view, auth.connected);
  renderSyncStatus(view, syncSt);
}

async function toggleConnection(view: View): Promise<void> {
  view.connectBtn.disabled = true;
  try {
    const { connected } = await send<{ connected: boolean }>({ type: "auth.status" });
    const next = connected
      ? await send<{ connected: boolean }>({ type: "auth.disconnect" })
      : await send<{ connected: boolean }>({ type: "auth.connect" });
    setConnected(view, next.connected);
  } catch (err) {
    setStatus(view, "error", err instanceof Error ? err.message : String(err));
  } finally {
    view.connectBtn.disabled = false;
  }
}

async function triggerSync(view: View): Promise<void> {
  view.syncBtn.disabled = true;
  try {
    const s = await send<SyncStatusData>({ type: "sync.now" });
    renderSyncStatus(view, s);
    setTimeout(() => { void refresh(view); }, 5_000);
  } catch (err) {
    setStatus(view, "error", err instanceof Error ? err.message : String(err));
  } finally {
    view.syncBtn.disabled = false;
  }
}

async function triggerCapture(view: View): Promise<void> {
  view.captureBtn.disabled = true;
  setStatus(view, "idle", "CAPTURING…");
  view.captureSource.textContent = "";
  try {
    const r = await send<CaptureResultData>({ type: "capture.activeTab" });
    setStatus(view, "connected", `SAVED · ${r.citeKey}`);
    view.captureSource.textContent = `PDF · ${r.pdfSource.toUpperCase()}`;
  } catch (err) {
    setStatus(view, "error", err instanceof Error ? err.message : String(err));
  } finally {
    view.captureBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  const view: View = {
    status: $("status"),
    syncStatus: $("sync-status"),
    captureSource: $("capture-source"),
    connectBtn: $("connect") as HTMLButtonElement,
    syncBtn: $("sync-now") as HTMLButtonElement,
    captureBtn: $("capture") as HTMLButtonElement,
    libraryBtn: $("open-library") as HTMLButtonElement,
  };

  view.connectBtn.addEventListener("click", () => { void toggleConnection(view); });
  view.syncBtn.addEventListener("click", () => { void triggerSync(view); });
  view.captureBtn.addEventListener("click", () => { void triggerCapture(view); });
  view.libraryBtn.addEventListener("click", async () => {
    const url = bx.runtime.getURL("library-page/index.html");
    await bx.tabs.create({ url });
  });

  try {
    await refresh(view);
  } catch (err) {
    setStatus(view, "error", err instanceof Error ? err.message : String(err));
  }
}

void init();
