/**
 * Syncs the local library with Google Drive from the terminal. It runs the very same core SyncEngine as the VS Code
 * extension, against the same manifest (.research/sync/google-drive.state.json), with the same Drive folder naming
 * (core buildLibraryFolderNames), so either app can sync the folder and the other sees a consistent state. A shared
 * lock keeps the two from syncing at the same time, and a shared "last run" record lets each show when the library
 * last synced and skip a periodic run the other app just did.
 *
 * Triggers: on demand (S, `labshelf sync`), 30 s after a change made in the terminal (same debounce as VS Code), and
 * periodically while the TUI is open.
 *
 *          platform/nodeLockStore, library/*
 */
import * as os from "node:os";

import {
  buildLibraryFolderNames,
  createGoogleDriveProvider,
  readSyncRunRecord,
  summarizeSyncResult,
  SyncEngine,
  SyncLock,
  SyncManifest,
  writeSyncRunRecord,
  type ILogger,
  type RemoteProvider,
  type SyncLockInfo,
  type SyncResult,
  type SyncRunRecord,
  SYNC_PROVIDER_ID,
  syncRoots,
} from "@labshelf/core";
import { NodeLocalFileSystem } from "@labshelf/core/node";

import { isProcessAlive, NodeLockStore } from "../platform/nodeLockStore.js";
import { type LibraryRoot, scanLibrary, type LibraryStore } from "../library/index.js";
import { ReauthRequiredError, type CliDriveAuth, type LoginOptions } from "./driveAuth.js";

export const APP_ID = "terminal";
const LOCAL_CHANGE_DEBOUNCE_MS = 30_000;

export type SyncState = "unconfigured" | "disconnected" | "idle" | "syncing" | "waiting" | "error";

export interface SyncStatus {
  state: SyncState;
  /** Last successful sync of this library by any app. */
  lastRun?: SyncRunRecord;
  lastError?: string;
  /** The app holding the lock while state is "waiting". */
  holder?: SyncLockInfo;
}

export type SyncOutcome =
  | { kind: "synced"; record: SyncRunRecord; result: SyncResult }
  | { kind: "busy"; holder: SyncLockInfo | undefined }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string; reauth: boolean };

export interface SyncServiceDeps {
  paths: LibraryRoot;
  auth: CliDriveAuth;
  store?: LibraryStore;
  logger: ILogger;
  /** Injectable for tests; defaults to the Drive provider. */
  providerFactory?: (auth: CliDriveAuth) => RemoteProvider;
  now?: () => Date;
  host?: string;
}

/**
 * Library namespace changes worth a rescan: something arrived, left or conflicted locally.
 * @returns true when the local library changed
 */
export function libraryChanged(result: SyncResult): boolean {
  return result.namespaces.some((ns) => ns.downloaded > 0 || ns.deletedLocal > 0 || ns.conflicts.length > 0);
}

export class SyncService {
  private current: SyncStatus = { state: "disconnected" };
  private running: Promise<SyncOutcome> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private periodic: ReturnType<typeof setInterval> | undefined;
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private readonly localFs: NodeLocalFileSystem;
  private readonly host: string;

  constructor(private readonly deps: SyncServiceDeps) {
    this.localFs = new NodeLocalFileSystem(deps.paths.layout.tmpDir());
    this.host = deps.host ?? os.hostname();
  }

  /** @returns the latest status */
  status(): SyncStatus {
    return this.current;
  }

  /**
   * @returns an unsubscribe function
   */
  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SyncStatus>, clear: Array<keyof SyncStatus> = []): void {
    const next: SyncStatus = { ...this.current, ...patch };
    for (const key of clear) { delete next[key]; }
    this.current = next;
    for (const listener of this.listeners) { listener(next); }
  }

  private baseState(): SyncState {
    if (!this.deps.auth.isConfigured()) { return "unconfigured"; }
    return this.deps.auth.isAuthenticated() ? "idle" : "disconnected";
  }

  /**
   * Loads stored credentials and the shared last-run record.
   * @returns the status
   */
  async init(): Promise<SyncStatus> {
    await this.deps.auth.load();
    const lastRun = await readSyncRunRecord(this.localFs, this.deps.paths.layout.lastRunPath());
    this.set({ state: this.baseState(), ...(lastRun ? { lastRun } : {}) });
    return this.current;
  }

  /**
   * Re-reads the shared last-run record (another app may have synced).
   * @returns void
   */
  async refreshLastRun(): Promise<void> {
    const lastRun = await readSyncRunRecord(this.localFs, this.deps.paths.layout.lastRunPath());
    if (lastRun && lastRun.finishedAt !== this.current.lastRun?.finishedAt) { this.set({ lastRun }); }
    // "Waiting for VS Code" lasts only as long as its lock does.
    if (this.current.state === "waiting" && (await new NodeLockStore().read(this.deps.paths.layout.lockPath())) === undefined) {
      this.set({ state: this.baseState() }, ["holder"]);
    }
  }

  /**
   * Runs one sync now. Concurrent calls in this process share one run; a run in another app is reported as busy.
   * @returns what happened
   */
  syncNow(reason = "manual"): Promise<SyncOutcome> {
    this.running ??= this.run(reason).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async run(reason: string): Promise<SyncOutcome> {
    if (!this.deps.auth.isConfigured()) {
      this.set({ state: "unconfigured" });
      return { kind: "skipped", reason: "no Google OAuth client configured" };
    }
    await this.deps.auth.load();
    if (!this.deps.auth.isAuthenticated()) {
      this.set({ state: "disconnected" });
      return { kind: "skipped", reason: "not signed in to Google Drive" };
    }
    const { paths } = this.deps;
    const lock = new SyncLock(new NodeLockStore(), paths.layout.lockPath(), { app: APP_ID, pid: process.pid, host: this.host }, {
      isProcessAlive,
      ...(this.deps.now ? { now: this.deps.now } : {}),
    });
    this.set({ state: "syncing" }, ["lastError", "holder"]);
    try {
      const attempt = await lock.runExclusive(() => this.runEngine());
      if (!attempt.ran) {
        this.set({ state: "waiting", ...(attempt.holder ? { holder: attempt.holder } : {}) });
        await this.deps.logger.log("INFO", "terminal/sync", "Sync skipped: another app is syncing this library", {
          reason, holder: attempt.holder,
        });
        return { kind: "busy", holder: attempt.holder };
      }
      const result = attempt.value;
      const record = summarizeSyncResult(result, APP_ID, this.host);
      await writeSyncRunRecord(this.localFs, paths.layout.lastRunPath(), record);
      this.set({ state: "idle", lastRun: record }, ["holder"]);
      await this.deps.logger.log("INFO", "terminal/sync", "Sync finished", { reason, ...record });
      if (libraryChanged(result)) { await this.deps.store?.reload(); }
      return { kind: "synced", record, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reauth = error instanceof ReauthRequiredError;
      this.set({ state: reauth ? "disconnected" : "error", lastError: message });
      await this.deps.logger.log("ERROR", "terminal/sync", "Sync failed", { reason, message });
      return { kind: "failed", error: message, reauth };
    }
  }

  private async runEngine(): Promise<SyncResult> {
    const { paths, auth } = this.deps;
    // Titles straight from disk, not from a possibly stale view: Drive folder names are derived from them.
    const snapshot = await scanLibrary(paths);
    const folderNames = buildLibraryFolderNames([...snapshot.papers.values()].map((e) => [e.record.id, e.record.title] as const));
    const manifest = await SyncManifest.load(this.localFs, paths.layout.manifestPath(), SYNC_PROVIDER_ID);
    const provider = this.deps.providerFactory ? this.deps.providerFactory(auth) : createGoogleDriveProvider(auth);
    const engine = new SyncEngine({
      provider,
      fs: this.localFs,
      manifest,
      roots: syncRoots(paths.layout),
      libraryFolderNames: folderNames,
      ...(this.deps.now ? { clock: this.deps.now } : {}),
    });
    return engine.run();
  }

  /**
   * Schedules a sync 30 s after the last local change (a burst of edits syncs once).
   * @returns void
   */
  notifyLocalChange(): void {
    if (this.baseState() !== "idle") { return; }
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.syncNow("local-change"); }, LOCAL_CHANGE_DEBOUNCE_MS);
    this.debounce.unref?.();
  }

  /**
   * Syncs every `minutes` while running, skipping a tick when any app synced within the last half interval.
   * @returns void
   */
  startPeriodic(minutes: number): void {
    this.stopPeriodic();
    if (!(minutes > 0)) { return; }
    const intervalMs = minutes * 60_000;
    this.periodic = setInterval(() => { void this.periodicTick(intervalMs); }, intervalMs);
    this.periodic.unref?.();
  }

  /**
   * One periodic tick, exposed for the TUI start-up sync and tests.
   * @returns the outcome, or undefined when skipped as recent
   */
  async periodicTick(intervalMs: number): Promise<SyncOutcome | undefined> {
    if (this.baseState() !== "idle") { return undefined; }
    await this.refreshLastRun();
    const last = this.current.lastRun ? Date.parse(this.current.lastRun.finishedAt) : 0;
    const now = (this.deps.now?.() ?? new Date()).getTime();
    if (now - last < intervalMs / 2) { return undefined; }
    return this.syncNow("periodic");
  }

  private stopPeriodic(): void {
    if (this.periodic) { clearInterval(this.periodic); }
    this.periodic = undefined;
  }

  /**
   * Signs in to Google Drive.
   * @returns void
   */
  async login(options: LoginOptions): Promise<void> {
    await this.deps.auth.login(options);
    this.set({ state: "idle" }, ["lastError"]);
    await this.deps.logger.log("INFO", "terminal/sync", "Signed in to Google Drive", { store: this.deps.auth.storeKind });
  }

  /**
   * Signs out and forgets the tokens. The library and the manifest stay.
   * @returns void
   */
  async logout(): Promise<void> {
    await this.deps.auth.revoke();
    this.set({ state: this.baseState() }, ["lastError"]);
    await this.deps.logger.log("INFO", "terminal/sync", "Signed out of Google Drive", {});
  }

  /**
   * Stops timers; an in-flight sync finishes on its own.
   * @returns the in-flight sync, if any, so a quitting CLI can wait for it
   */
  stop(): Promise<SyncOutcome> | undefined {
    clearTimeout(this.debounce);
    this.stopPeriodic();
    return this.running;
  }
}
