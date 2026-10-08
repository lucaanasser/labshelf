/** Orchestrates the sync lifecycle — auth, engine wiring, debounced auto-sync on library events, periodic polling, and status bar feedback. Shares the library with the terminal app: both hold the core SyncLock while syncing, name Drive folders with the same core rule, and record each run in the shared last-run file. @depends vscode, @labshelf/core, googleDriveAuth, vscodeLocalFileSystem, nodeLockStore, libraryPaths. @dependents extension */
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import type { ILibraryPaths } from "../../storage/paths/libraryPaths.js";
import {
  buildLibraryFolderNames,
  createGoogleDriveProvider,
  readSyncRunRecord,
  summarizeSyncResult,
  SyncEngine,
  SyncLock,
  SyncManifest,
  writeSyncRunRecord,
} from "@labshelf/core";
import type {
  EventBus,
  SyncResult,
  FolderNameMaps,
  SyncLockInfo,
} from "@labshelf/core";
import { GoogleDriveAuth } from "../auth/googleDriveAuth.js";
import { VscodeLocalFileSystem } from "./vscodeLocalFileSystem.js";
import { isProcessAlive, NodeLockStore } from "./nodeLockStore.js";

const DEBOUNCE_MS = 30_000;
const PROVIDER_ID = "google-drive";
const APP_ID = "vscode";

/** Where a sync request came from: a manual one reports a busy lock, an automatic one stays quiet. */
export type SyncReason = "manual" | "auto";

export class SyncController implements vscode.Disposable {
  private readonly auth: GoogleDriveAuth;
  private readonly localFs: VscodeLocalFileSystem;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly _onDidChangeStatus = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus: vscode.Event<void> = this._onDidChangeStatus.event;
  // Fired after a successful sync so the host can re-index when Drive pulled
  // files in (a paper, or a paper's PDF, that arrived on another device).
  private readonly _onDidSync = new vscode.EventEmitter<SyncResult>();
  readonly onDidSync: vscode.Event<SyncResult> = this._onDidSync.event;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private periodicTimer: ReturnType<typeof setInterval> | undefined;
  private syncing = false;
  private lastSyncTime: string | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private paths: ILibraryPaths,
    eventBus: EventBus,
    /** Returns a paperId → title map used to name Drive folders. */
    private readonly getPaperTitles?: () => Promise<Map<string, string>>,
  ) {
    this.auth = new GoogleDriveAuth(context);
    this.localFs = new VscodeLocalFileSystem();

    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBar.command = "labshelf.sync.now";
    this.disposables.push(this.statusBar);

    // Debounce a sync whenever any library change event fires.
    const scheduleSync = (): void => this.scheduleDebounce();
    eventBus.on("paper:added", scheduleSync);
    eventBus.on("paper:deleted", scheduleSync);
    eventBus.on("paper:updated", scheduleSync);
    eventBus.on("annotation:created", scheduleSync);
    eventBus.on("annotation:updated", scheduleSync);
    eventBus.on("annotation:deleted", scheduleSync);
  }

  /** Points the controller at another library, so the lock, manifest and synced folders follow a reconfigured root. */
  setPaths(paths: ILibraryPaths): void {
    this.paths = paths;
  }

  /** Loads persisted auth state and starts periodic sync if already authenticated. @usedBy extension. @returns void */
  async initialize(): Promise<void> {
    await this.auth.loadPersistedState();
    this.updateStatusBar();
    if (this.auth.isAuthenticated()) {
      this.startPeriodicSync();
    }
  }

  /** Authenticates with Google Drive, starts periodic sync, and runs an initial sync. @usedBy extension. @returns void */
  async connect(): Promise<void> {
    await this.auth.authenticate();
    this.updateStatusBar();
    this.startPeriodicSync();
    vscode.window.showInformationMessage("LabShelf: Connected to Google Drive.");
    await this.sync();
  }

  /** Stops periodic sync and revokes Google Drive credentials. @usedBy extension. @returns void */
  async disconnect(): Promise<void> {
    this.stopPeriodicSync();
    await this.auth.revoke();
    this.updateStatusBar();
    vscode.window.showInformationMessage("LabShelf: Disconnected from Google Drive.");
  }

  /** Runs a full sync if authenticated, updating the status bar and reporting results. Skips (quietly when automatic) while another app — the terminal, another window — holds the library's sync lock. @usedBy extension. @returns void */
  async sync(reason: SyncReason = "manual"): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      if (reason === "manual") {
        vscode.window.showWarningMessage("LabShelf Sync: connect to Google Drive first.");
      }
      return;
    }
    if (this.syncing) { return; }
    this.syncing = true;
    this.statusBar.text = "$(sync~spin) LabShelf Sync";
    this.statusBar.show();
    this._onDidChangeStatus.fire();

    try {
      const lock = new SyncLock(new NodeLockStore(), this.lockPath(), { app: APP_ID, pid: process.pid, host: os.hostname() }, { isProcessAlive });
      const attempt = await lock.runExclusive(() => this.runEngine());
      if (!attempt.ran) {
        this.reportBusy(attempt.holder, reason);
        return;
      }
      const result = attempt.value;
      this.lastSyncTime = new Date().toLocaleTimeString();
      await this.recordRun(result);
      this.reportResult(result);
      this._onDidSync.fire(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`LabShelf Sync: ${msg}`);
      this.statusBar.text = "$(sync-ignored) LabShelf";
    } finally {
      this.syncing = false;
      this._onDidChangeStatus.fire();
    }
  }

  /** Returns whether the controller is currently authenticated with Google Drive. @usedBy ui/settings/settingsWebviewPanel.ts. @returns boolean */
  isConnected(): boolean {
    return this.auth.isAuthenticated();
  }

  /** Returns whether a sync operation is currently in progress. @usedBy ui/settings/settingsWebviewPanel.ts. @returns boolean */
  isSyncing(): boolean {
    return this.syncing;
  }

  /** Returns the locale time string of the last successful sync, or null. @usedBy ui/settings/settingsWebviewPanel.ts. @returns string | null */
  getLastSyncTime(): string | null {
    return this.lastSyncTime;
  }

  // Builds the paperId ↔ display title translation maps used to name Drive folders (the core rule the terminal shares).
  private async buildFolderNames(): Promise<FolderNameMaps | undefined> {
    if (!this.getPaperTitles) return undefined;
    return buildLibraryFolderNames(await this.getPaperTitles());
  }

  private lockPath(): string {
    return path.join(this.paths.syncDir().fsPath, `${PROVIDER_ID}.lock`);
  }

  private lastRunPath(): string {
    return path.join(this.paths.syncDir().fsPath, `${PROVIDER_ID}.last.json`);
  }

  // Records the run for the other apps on this library; a failure here must not fail the sync itself.
  private async recordRun(result: SyncResult): Promise<void> {
    try {
      await writeSyncRunRecord(this.localFs, this.lastRunPath(), summarizeSyncResult(result, APP_ID, os.hostname()));
    } catch {
      // The record is informational.
    }
  }

  // Another app is syncing this library: its changes arrive through the file watcher, so only a manual request says so.
  private reportBusy(holder: SyncLockInfo | undefined, reason: SyncReason): void {
    this.statusBar.text = "$(cloud) LabShelf";
    if (reason === "manual") {
      const who = holder?.app === "terminal" ? "The LabShelf terminal app" : "Another LabShelf window";
      vscode.window.setStatusBarMessage(`LabShelf Sync: ${who} is syncing this library right now.`, 6000);
    }
  }

  // True when any app on this library synced within the last half interval, so a periodic run would find nothing new.
  private async syncedRecently(intervalMs: number): Promise<boolean> {
    const last = await readSyncRunRecord(this.localFs, this.lastRunPath()).catch(() => undefined);
    return last !== undefined && Date.now() - Date.parse(last.finishedAt) < intervalMs / 2;
  }

  // Instantiates the provider, manifest, and engine, then runs a full sync.
  private async runEngine(): Promise<SyncResult> {
    const provider = createGoogleDriveProvider(this.auth);
    const manifestPath = path.join(this.paths.syncDir().fsPath, `${PROVIDER_ID}.state.json`);
    const manifest = await SyncManifest.load(this.localFs, manifestPath, PROVIDER_ID);
    const folderNames = await this.buildFolderNames();
    const engine = new SyncEngine({
      provider,
      fs: this.localFs,
      manifest,
      roots: {
        library: this.paths.papersRoot().fsPath,
        appdata: this.paths.paperDataRoot().fsPath,
      },
      ...(folderNames !== undefined ? { libraryFolderNames: folderNames } : {}),
    });
    return engine.run();
  }

  // Displays a status bar message and optional warning for conflicts after a sync run.
  private reportResult(result: SyncResult): void {
    const total = result.namespaces.reduce(
      (acc, ns) => acc + ns.uploaded + ns.downloaded + ns.deletedLocal + ns.deletedRemote,
      0,
    );
    const conflicts = result.namespaces.flatMap(ns => ns.conflicts);
    const now = new Date().toLocaleTimeString();
    this.statusBar.text = `$(cloud) LabShelf (${now})`;

    if (conflicts.length > 0) {
      vscode.window.showWarningMessage(
        `LabShelf Sync: ${conflicts.length} conflict(s) detected. Duplicate files saved with a "(conflict)" suffix.`,
      );
    } else if (total > 0) {
      vscode.window.setStatusBarMessage(`LabShelf Sync: ${total} file(s) synced`, 4000);
    }
  }

  // Schedules a debounced sync if authenticated, resetting any pending timer.
  private scheduleDebounce(): void {
    if (!this.auth.isAuthenticated()) { return; }
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => { void this.sync("auto"); }, DEBOUNCE_MS);
  }

  // Starts the periodic sync interval using the configured autoSyncIntervalMinutes setting.
  private startPeriodicSync(): void {
    this.stopPeriodicSync();
    const intervalMin = vscode.workspace
      .getConfiguration("labshelf")
      .get<number>("sync.autoSyncIntervalMinutes", 15);
    const intervalMs = intervalMin * 60_000;
    this.periodicTimer = setInterval(() => {
      void this.syncedRecently(intervalMs).then((recent) => { if (!recent) { void this.sync("auto"); } });
    }, intervalMs);
  }

  // Clears the periodic sync interval if running.
  private stopPeriodicSync(): void {
    if (this.periodicTimer !== undefined) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }
  }

  // Updates the status bar item to reflect the current auth state.
  private updateStatusBar(): void {
    if (this.auth.isAuthenticated()) {
      this.statusBar.text = "$(cloud) LabShelf";
      this.statusBar.tooltip = "LabShelf: synced with Google Drive. Click to sync.";
      this.statusBar.command = "labshelf.sync.now";
      this.statusBar.show();
    } else {
      this.statusBar.text = "$(cloud-upload) LabShelf";
      this.statusBar.tooltip = "LabShelf: not synced. Click to connect to Drive.";
      this.statusBar.command = "labshelf.sync.connect";
      this.statusBar.show();
    }
    this._onDidChangeStatus.fire();
  }

  dispose(): void {
    clearTimeout(this.debounceTimer);
    this.stopPeriodicSync();
    this._onDidChangeStatus.dispose();
    this._onDidSync.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
