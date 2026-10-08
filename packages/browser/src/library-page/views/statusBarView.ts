/**
 * Bottom status bar, drawn like VS Code's: the sync item on the left mirrors
 * the VS Code extension's status bar entry (cloud when connected, spinning
 * sync while in flight, cloud-off when disconnected; click runs a sync), the
 * right side shows the paper count, the theme toggle and a settings shortcut.
 *
 * @depends ui/dom, ui/icons, ui/theme, platform/browserApi, state/libraryStore, events
 * @dependents library-page/index
 */
import { $, shortTime } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { cycleThemePref, onThemeChange } from "../../ui/theme";
import type { ThemePref } from "../../ui/theme";
import { bx } from "../../platform/browserApi";
import type { SyncStatusData } from "../../platform/runtimeMessages";
import { emit } from "../events";
import type { LibraryStore } from "../state/libraryStore";

const THEME_LABEL: Record<ThemePref, string> = { auto: "Theme: follows the system", light: "Theme: light", dark: "Theme: dark" };

/** Mounts the status bar and returns an unsubscribe function. */
export function mountStatusBar(container: HTMLElement, store: LibraryStore): () => void {
  container.innerHTML = `
    <div class="status-left">
      <button class="status-item clickable" id="syncItem" type="button" title="Sync with Google Drive now"></button>
    </div>
    <div class="status-right">
      <span class="status-item" id="countItem"></span>
      <button class="status-item clickable" id="themeItem" type="button"></button>
      <button class="status-item clickable" id="settingsItem" type="button" title="LabShelf settings">${icon("gear")}</button>
    </div>
  `;
  const syncItem = $<HTMLButtonElement>("syncItem", container);
  const themeItem = $<HTMLButtonElement>("themeItem", container);

  syncItem.addEventListener("click", () => emit("labshelf:sync-now", {}));
  themeItem.addEventListener("click", () => cycleThemePref());
  $("settingsItem", container).addEventListener("click", () => { void bx.runtime.openOptionsPage(); });

  const offTheme = onThemeChange((theme, pref) => {
    themeItem.innerHTML = icon(theme === "dark" ? "moon" : "sun");
    themeItem.title = `${THEME_LABEL[pref]} — click to change`;
  });
  const offStore = store.select(
    (s) => ({ sync: s.sync, count: s.papers.length }),
    ({ sync, count }) => {
      renderSync(syncItem, sync);
      $("countItem", container).textContent = `${count} paper${count === 1 ? "" : "s"}`;
    },
  );
  return () => { offTheme(); offStore(); };
}

function renderSync(el: HTMLButtonElement, sync: SyncStatusData | null): void {
  el.classList.remove("error");
  if (!sync) { el.innerHTML = `${icon("cloud-off")}<span>LabShelf</span>`; el.title = "Sync status unavailable"; return; }
  if (sync.syncing) { el.innerHTML = `<span class="spin">${icon("sync")}</span><span>LabShelf Sync</span>`; el.title = "Syncing with Google Drive…"; return; }
  if (sync.lastError) {
    el.classList.add("error");
    el.innerHTML = `${icon("warning")}<span>Sync failed</span>`;
    el.title = `${sync.lastError} — click to retry`;
    return;
  }
  if (!sync.connected) { el.innerHTML = `${icon("cloud-off")}<span>Not connected</span>`; el.title = "Connect to Google Drive in the LabShelf popup or settings"; return; }
  const when = sync.lastSyncTime ? ` (${shortTime(sync.lastSyncTime)})` : "";
  el.innerHTML = `${icon("cloud")}<span>LabShelf${when}</span>`;
  el.title = sync.lastSyncTime ? `Last synced ${new Date(sync.lastSyncTime).toLocaleString()} — click to sync now` : "Connected — click to sync now";
}
