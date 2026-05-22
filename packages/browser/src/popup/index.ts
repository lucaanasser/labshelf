/**
 * Popup bootstrap. Phase 2 hooks the "Connect to Drive" button to the
 * background auth provider and renders the current connection state. Capture
 * and library actions remain placeholders for Phases 5 and 6.
 * @depends platform/browserApi, platform/runtimeMessages.
 * @dependents popup/index.html.
 */
import { bx } from "../platform/browserApi";
import type { RuntimeMessage, RuntimeResponse } from "../platform/runtimeMessages";

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
  connectBtn: HTMLButtonElement;
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
  } else {
    setStatus(view, "idle", "disconnected");
    view.connectBtn.textContent = "Connect to Drive";
  }
}

async function refresh(view: View): Promise<void> {
  const { connected } = await send<{ connected: boolean }>({ type: "auth.status" });
  setConnected(view, connected);
}

async function toggleConnection(view: View): Promise<void> {
  const { connected } = await send<{ connected: boolean }>({ type: "auth.status" });
  view.connectBtn.disabled = true;
  try {
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

async function init(): Promise<void> {
  const view: View = {
    status: $("status"),
    connectBtn: $("connect") as HTMLButtonElement,
    captureBtn: $("capture") as HTMLButtonElement,
    libraryBtn: $("open-library") as HTMLButtonElement,
  };

  view.connectBtn.addEventListener("click", () => { void toggleConnection(view); });
  view.captureBtn.addEventListener("click", () => {
    setStatus(view, "idle", "capture not implemented yet");
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
