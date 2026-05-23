/**
 * Schedules periodic background sync via bx.alarms. Reads autoSyncMinutes from
 * the persisted settings and re-creates the alarm whenever that value changes,
 * so the options page edits take effect without an extension reload. The
 * trigger is invoked with reason="alarm" when the alarm fires.
 * @depends platform/browserApi, platform/settings, platform/logger
 * @dependents background/index
 */
import { bx } from "../platform/browserApi";
import { getSettings } from "../platform/settings";
import { BrowserLogger } from "../platform/logger";

export const AUTO_SYNC_ALARM = "labshelf.autoSync";
const SETTINGS_KEY = "labshelf.settings";

/** Fired by every Phase 7 trigger source; the background wires it to BrowserSyncController.sync. */
export type SyncTrigger = (reason: string) => void;

export interface AutoSyncSchedulerOptions {
  trigger: SyncTrigger;
  logger?: BrowserLogger;
}

/**
 * Installs the recurring alarm and the storage listener that adapts the
 * interval when the user changes it in the options page.
 * @usedBy background/index
 */
export async function installAutoSyncScheduler(opts: AutoSyncSchedulerOptions): Promise<void> {
  const { trigger, logger = new BrowserLogger("scheduler") } = opts;

  await applyInterval(logger);

  bx.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_SYNC_ALARM) return;
    trigger("alarm");
  });

  bx.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!(SETTINGS_KEY in changes)) return;
    void applyInterval(logger);
  });
}

async function applyInterval(logger: BrowserLogger): Promise<void> {
  const { autoSyncMinutes } = await getSettings();
  await bx.alarms.clear(AUTO_SYNC_ALARM);
  if (autoSyncMinutes <= 0) {
    await logger.info("auto-sync disabled");
    return;
  }
  // Chrome MV3 enforces a 1-minute minimum periodInMinutes in production.
  const period = Math.max(1, Math.floor(autoSyncMinutes));
  await bx.alarms.create(AUTO_SYNC_ALARM, { periodInMinutes: period });
  await logger.info("auto-sync scheduled", { periodInMinutes: period });
}
