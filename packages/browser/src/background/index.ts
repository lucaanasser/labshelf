/**
 * Background entry. In MV3 Chrome this runs as a service worker; in Firefox
 * it runs as a non-persistent background script. Phase 1 only wires logging
 * and a ping handler so the UI can verify the message channel works.
 * @depends platform/browserApi, platform/logger, platform/runtimeMessages.
 * @dependents none (entry point).
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import type { RuntimeMessage, RuntimeResponse } from "../platform/runtimeMessages";

const log = new BrowserLogger("background");

bx.runtime.onInstalled.addListener((details) => {
  void log.info("extension installed", { reason: details.reason });
});

bx.runtime.onStartup.addListener(() => {
  void log.info("browser startup");
});

bx.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as RuntimeMessage;
  handle(msg)
    .then((data) => sendResponse({ ok: true, data } satisfies RuntimeResponse))
    .catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      void log.error("message handler failed", { type: msg?.type, error });
      sendResponse({ ok: false, error } satisfies RuntimeResponse);
    });
  return true;
});

async function handle(msg: RuntimeMessage): Promise<unknown> {
  switch (msg.type) {
    case "ping":
      return { pong: true, at: new Date().toISOString() };
    default:
      throw new Error(`Unhandled message type: ${msg.type}`);
  }
}
