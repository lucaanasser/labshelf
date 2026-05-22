/**
 * Popup bootstrap. Hooks the Connect/Disconnect and Sync Now buttons to the
 * background auth and sync controllers. Polls sync status on open so the user
 * always sees the current state without needing to interact first.
 * @depends platform/browserApi, platform/runtimeMessages.
 * @dependents popup/index.html.
 */
import { bx } from "../platform/browserApi";
import type { RuntimeMessage, RuntimeResponse, SyncStatusData, CaptureResultData } from "../platform/runtimeMessages";

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
  connectBtn: HTMLButtonElement;
  syncBtn: HTMLButtonElement;
  captureBtn: HTMLButtonElement;
  libraryBtn: HTMLButtonElement;
}

function setStatus(view: View, state: "idle" | "connected" | "error", text: string): void {
  view.status.dataset["state"] = state;
  view.status.textContent = text;
}

function setConnected(view: View, connected: boolean): void {
  if (connected) {
    setStatus(view, "connected", "connected");
    view.connectBtn.textContent = "Disconnect";
    view.syncBtn.disabled = false;
  } else {
    setStatus(view, "idle", "disconnected");
    view.connectBtn.textContent = "Connect to Drive";
    view.syncBtn.disabled = true;
  }
}

function renderSyncStatus(view: View, s: SyncStatusData): void {
  if (s.syncing) {
    view.syncStatus.textContent = "syncing…";
  } else if (s.lastError) {
    view.syncStatus.textContent = `sync error: ${s.lastError}`;
  } else if (s.lastSyncTime) {
    const t = new Date(s.lastSyncTime).toLocaleTimeString();
    view.syncStatus.textContent = `last sync: ${t}`;
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
    // Poll once after a short delay to pick up completion.
    setTimeout(() => { void refresh(view); }, 5_000);
  } catch (err) {
    setStatus(view, "error", err instanceof Error ? err.message : String(err));
  } finally {
    view.syncBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  const view: View = {
    status: $("status"),
    syncStatus: $("sync-status"),
    connectBtn: $("connect") as HTMLButtonElement,
    syncBtn: $("sync-now") as HTMLButtonElement,
    captureBtn: $("capture") as HTMLButtonElement,
    libraryBtn: $("open-library") as HTMLButtonElement,
  };

  view.connectBtn.addEventListener("click", () => { void toggleConnection(view); });
  view.syncBtn.addEventListener("click", () => { void triggerSync(view); });
  view.captureBtn.addEventListener("click", async () => {
    view.captureBtn.disabled = true;
    setStatus(view, "idle", "capturing…");
    try {
      const r = await send<CaptureResultData>({ type: "capture.activeTab" });
      setStatus(view, "connected", `Saved: ${r.title}`);
    } catch (err) {
      setStatus(view, "error", err instanceof Error ? err.message : String(err));
    } finally {
      view.captureBtn.disabled = false;
    }
  });
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
