/**
 * Fires the sync trigger whenever the browser idle state flips to "idle". The
 * threshold is 5 minutes (matching the plan) and a minimum gap prevents the
 * trigger from firing more than once per minute, so locking/unlocking the
 * machine in quick succession doesn't queue a flurry of syncs.
 * @depends platform/browserApi, platform/logger, background/autoSyncScheduler
 * @dependents background/index
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import type { SyncTrigger } from "./autoSyncScheduler";

const IDLE_DETECTION_SECONDS = 300;
const MIN_GAP_MS = 60_000;

export interface IdleSyncOptions {
  trigger: SyncTrigger;
  logger?: BrowserLogger;
}

/**
 * Subscribes to bx.idle transitions and forwards the "idle" state to the sync
 * trigger.
 * @usedBy background/index
 */
export function installIdleSyncTrigger(opts: IdleSyncOptions): void {
  const { trigger, logger = new BrowserLogger("idle") } = opts;
  try {
    bx.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  } catch {
    // Some platforms ignore set(); the default detection interval still applies.
  }
  let lastTrigger = 0;
  bx.idle.onStateChanged.addListener((state) => {
    if (state !== "idle") return;
    const now = Date.now();
    if (now - lastTrigger < MIN_GAP_MS) return;
    lastTrigger = now;
    void logger.info("idle transition — scheduling sync");
    trigger("idle");
  });
}
