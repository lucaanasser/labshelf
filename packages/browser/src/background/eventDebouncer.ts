/**
 * Coalesces library-change signals (paper added/updated/deleted, folder rename,
 * etc.) into one trailing sync. Backed by bx.alarms — not setTimeout — so the
 * trigger survives service-worker suspension between the "paper added" signal
 * and the actual fire 30 s later. Each schedule() resets the alarm, so a burst
 * of changes collapses into a single sync.
 * @depends platform/browserApi, platform/logger, background/autoSyncScheduler
 * @dependents background/index
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import type { SyncTrigger } from "./autoSyncScheduler";

export const DEBOUNCED_SYNC_ALARM = "labshelf.debouncedSync";
// 0.5 minutes = 30 s, the minimum alarm delay Chrome MV3 honours in production.
const DEBOUNCE_MINUTES = 0.5;

/**
 * Schedules a single trailing sync after a quiet period. Used by the capture
 * flow and by library-page actions that mutate IDB but want sync to follow.
 * @usedBy background/index
 */
export class SyncDebouncer {
  constructor(
    private readonly trigger: SyncTrigger,
    private readonly logger: BrowserLogger = new BrowserLogger("debouncer"),
  ) {
    bx.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== DEBOUNCED_SYNC_ALARM) return;
      void this.fire();
    });
  }

  /** Resets the timer. Trigger fires once the change bus has been quiet ~30 s. */
  async schedule(reason: string): Promise<void> {
    await this.logger.info("debounce scheduled", { reason });
    await bx.alarms.clear(DEBOUNCED_SYNC_ALARM);
    await bx.alarms.create(DEBOUNCED_SYNC_ALARM, { delayInMinutes: DEBOUNCE_MINUTES });
  }

  async cancel(): Promise<void> {
    await bx.alarms.clear(DEBOUNCED_SYNC_ALARM);
  }

  private async fire(): Promise<void> {
    await this.logger.info("debounce fired");
    this.trigger("debounced");
  }
}
