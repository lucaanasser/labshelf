/**
 * Reflects sync state on the toolbar action badge. Disconnected = no badge;
 * connected idle = dim dot; syncing = cycling spinner in blue; error = "!" in
 * red. A polling loop updates the badge ~1×/s so transient sync flips show up
 * without bespoke event plumbing.
 * @depends platform/browserApi, sync/browserSyncController
 * @dependents background/index
 */
import { bx } from "../platform/browserApi";
import type { SyncStatus } from "../sync/browserSyncController";

const POLL_MS = 1000;
// ASCII-only spinner frames (project rule: no emoji in UI text).
const SPINNER_FRAMES = [".  ", ".. ", "...", " ..", "  ."];
const COLOR_IDLE = "#6e6a60";
const COLOR_SYNC = "#5b8def";
const COLOR_ERROR = "#d05750";

/** Provided by background/index so the badge tracks the live controller. */
export type GetSyncStatus = () => SyncStatus;

/**
 * Starts the polling loop. Has no teardown — the MV3 service worker handles
 * lifecycle by suspending the entire context when idle.
 * @usedBy background/index
 */
export function installBadgeUpdater(getStatus: GetSyncStatus): void {
  let frame = 0;
  let lastSignature = "";

  const tick = (): void => {
    const status = getStatus();
    if (status.syncing) {
      const text = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? ".";
      void bx.action.setBadgeBackgroundColor({ color: COLOR_SYNC });
      void bx.action.setBadgeText({ text });
      void bx.action.setTitle({ title: "LabShelf — Syncing…" });
      frame += 1;
      lastSignature = "syncing";
      return;
    }
    const sig = signature(status);
    if (sig === lastSignature) return;
    lastSignature = sig;
    if (status.lastError) {
      void bx.action.setBadgeBackgroundColor({ color: COLOR_ERROR });
      void bx.action.setBadgeText({ text: "!" });
      void bx.action.setTitle({ title: `LabShelf — ${status.lastError}` });
      return;
    }
    if (status.connected) {
      void bx.action.setBadgeBackgroundColor({ color: COLOR_IDLE });
      void bx.action.setBadgeText({ text: "" });
      const when = status.lastSyncTime
        ? new Date(status.lastSyncTime).toLocaleTimeString()
        : "never";
      void bx.action.setTitle({ title: `LabShelf — last sync ${when}` });
      return;
    }
    void bx.action.setBadgeText({ text: "" });
    void bx.action.setTitle({ title: "LabShelf — disconnected" });
  };

  setInterval(tick, POLL_MS);
  tick();
}

function signature(s: SyncStatus): string {
  return [s.connected, s.syncing, s.lastError ?? "", s.lastSyncTime ?? ""].join("|");
}
