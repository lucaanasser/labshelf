/**
 * Popup bootstrap. Phase 1 wires the static buttons to placeholder handlers
 * and verifies the background message channel via a ping. Real auth + capture
 * arrive in later phases.
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

async function send(message: RuntimeMessage): Promise<RuntimeResponse> {
  return (await bx.runtime.sendMessage(message)) as RuntimeResponse;
}

async function init(): Promise<void> {
  const status = $("status");
  const connectBtn = $("connect") as HTMLButtonElement;
  const captureBtn = $("capture") as HTMLButtonElement;
  const libraryBtn = $("open-library") as HTMLButtonElement;

  const reply = await send({ type: "ping" });
  status.dataset["state"] = reply.ok ? "idle" : "error";
  status.textContent = reply.ok ? "ready" : "background offline";

  connectBtn.addEventListener("click", () => {
    status.textContent = "auth not implemented yet";
  });

  captureBtn.addEventListener("click", () => {
    status.textContent = "capture not implemented yet";
  });

  libraryBtn.addEventListener("click", async () => {
    const url = bx.runtime.getURL("library-page/index.html");
    await bx.tabs.create({ url });
  });
}

void init();
