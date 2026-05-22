/**
 * Background entry. In MV3 Chrome this runs as a service worker; in Firefox
 * it runs as a non-persistent background script. Phase 2 wires the Drive
 * auth provider into the runtime message channel so popup / options pages
 * can drive connect, disconnect, and status checks.
 * @depends platform/browserApi, platform/logger, platform/runtimeMessages,
 *          sync/auth/browserDriveAuth.
 * @dependents none (entry point).
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import type { RuntimeMessage, RuntimeResponse } from "../platform/runtimeMessages";
import { BrowserDriveAuth } from "../sync/auth/browserDriveAuth";

const log = new BrowserLogger("background");
const auth = new BrowserDriveAuth();

bx.runtime.onInstalled.addListener((details) => {
  void log.info("extension installed", { reason: details.reason });
});

bx.runtime.onStartup.addListener(() => {
  void log.info("browser startup");
});

bx.runtime.onMessage.addListener(async (message, _sender) => {
  const msg = message as RuntimeMessage;
  try {
    const data = await handle(msg);
    return { ok: true, data } satisfies RuntimeResponse;
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    void log.error("background", err, { type: msg?.type });
    return { ok: false, error } satisfies RuntimeResponse;
  }
});

async function handle(msg: RuntimeMessage): Promise<unknown> {
  switch (msg.type) {
    case "ping":
      return { pong: true, at: new Date().toISOString() };
    case "auth.status":
      return { connected: auth.isAuthenticated() };
    case "auth.connect":
      await auth.authenticate();
      await log.info("authenticated to Google Drive");
      return { connected: true };
    case "auth.disconnect":
      await auth.revoke();
      await log.info("disconnected from Google Drive");
      return { connected: false };
    case "sync.now":
    case "sync.status":
    case "capture.activeTab":
      throw new Error(`Not implemented yet: ${msg.type}`);
    default: {
      const exhaustive: never = msg;
      throw new Error(`Unhandled message type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
