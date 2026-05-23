/**
 * Background entry. In MV3 Chrome this runs as a service worker; in Firefox
 * it runs as a non-persistent background script. Wires Drive auth, sync
 * controller, capture, the Phase 7 schedulers (alarm + idle + debouncer) and
 * the toolbar badge updater into the runtime message channel so popup, options
 * and library-page surfaces can drive every flow.
 * @depends platform/browserApi, platform/logger, platform/runtimeMessages,
 *          sync/auth/browserDriveAuth, sync/browserSyncController, capture/index,
 *          background/autoSyncScheduler, background/syncOnIdle,
 *          background/eventDebouncer, background/badgeUpdater.
 * @dependents none (entry point).
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import type { RuntimeMessage, RuntimeResponse, CaptureResultData } from "../platform/runtimeMessages";
import { BrowserDriveAuth } from "../sync/auth/browserDriveAuth";
import { BrowserSyncController } from "../sync/browserSyncController";
import { captureActiveTab } from "../capture/index";
import { installAutoSyncScheduler } from "./autoSyncScheduler";
import type { SyncTrigger } from "./autoSyncScheduler";
import { installIdleSyncTrigger } from "./syncOnIdle";
import { SyncDebouncer } from "./eventDebouncer";
import { installBadgeUpdater } from "./badgeUpdater";

const log = new BrowserLogger("background");
const auth = new BrowserDriveAuth();
const sync = new BrowserSyncController(auth);

const triggerSync: SyncTrigger = (reason) => {
  void log.info("sync trigger", { reason });
  void sync.sync()
    .then(() => log.info("sync completed", sync.status() as unknown as Record<string, unknown>))
    .catch((err: unknown) => log.error("background", err, { op: "trigger", reason }));
};

const debouncer = new SyncDebouncer(triggerSync);

void installAutoSyncScheduler({ trigger: triggerSync, logger: log });
installIdleSyncTrigger({ trigger: triggerSync, logger: log });
installBadgeUpdater(() => sync.status());

bx.runtime.onInstalled.addListener((details) => {
  void log.info("extension installed", { reason: details.reason });
});

bx.runtime.onStartup.addListener(() => {
  void log.info("browser startup");
});

bx.runtime.onMessage.addListener(async (message: unknown, _sender: unknown) => {
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
    case "sync.status":
      return sync.status();
    case "sync.now": {
      // Fire-and-forget so the popup updates immediately. Cancel any pending
      // debounced sync — it would just duplicate this one.
      void debouncer.cancel();
      void sync.sync()
        .then(() => log.info("sync completed", sync.status() as unknown as Record<string, unknown>))
        .catch((err: unknown) => log.error("background", err, { op: "sync.now" }));
      return sync.status();
    }
    case "sync.scheduleSoon":
      await debouncer.schedule(msg.reason);
      return { scheduled: true };
    case "capture.activeTab": {
      const tabs = await bx.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) throw new Error("No active tab found.");
      const { paper, pdfSource } = await captureActiveTab(tab.id, tab.url ?? "");
      // Capture wrote to IDB; coalesce the follow-up sync.
      void debouncer.schedule("capture");
      return {
        title: paper.title,
        citeKey: paper.citeKey,
        pdfSource,
      } satisfies CaptureResultData;
    }
    default: {
      const exhaustive: never = msg;
      throw new Error(`Unhandled message type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
