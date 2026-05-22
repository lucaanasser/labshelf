/**
 * Orchestrates sync between the IndexedDB local store and Google Drive. Mirrors
 * the VSCode SyncController pattern but runs in the MV3 service worker with no
 * vscode dependency. The manifest is persisted in the IDB "manifest" store via
 * IdbManifestFileSystem so it survives service-worker restarts.
 *
 * After each successful sync the paperRecordStore is rebuilt from the updated
 * files, so the library page always sees current metadata.
 *
 * @depends storage/indexedDbFileSystem, storage/idbManifestFileSystem,
 *          storage/paperRecordStore, sync/auth/browserDriveAuth,
 *          @labshelf/core SyncEngine, SyncManifest, createGoogleDriveProvider
 * @dependents background/index
 */
import {
  SyncEngine,
  SyncManifest,
  createGoogleDriveProvider,
} from "@labshelf/core";
import type { SyncResult } from "@labshelf/core";
import { BrowserDriveAuth } from "./auth/browserDriveAuth";
import { IndexedDbFileSystem } from "../storage/indexedDbFileSystem";
import { IdbManifestFileSystem } from "../storage/idbManifestFileSystem";
import { rebuildFromFiles } from "../storage/paperRecordStore";

const PROVIDER_ID = "google-drive";

// Local roots: relative paths within the IDB file store.
const ROOTS = { library: "papers", appdata: "appdata" } as const;

export interface SyncStatus {
  connected: boolean;
  syncing: boolean;
  lastSyncTime: string | null;
  lastError: string | null;
}

/** Singleton sync controller wired into the background service worker. */
export class BrowserSyncController {
  private syncing = false;
  private lastSyncTime: string | null = null;
  private lastError: string | null = null;
  private readonly fs = new IndexedDbFileSystem();

  constructor(private readonly auth: BrowserDriveAuth) {}

  /** Returns a snapshot of the current sync state for the popup/options UI. */
  status(): SyncStatus {
    return {
      connected: this.auth.isAuthenticated(),
      syncing: this.syncing,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
    };
  }

  /**
   * Runs a full bidirectional sync. Throws if not authenticated or already
   * syncing. Rebuilds the paperRecordStore cache on success.
   */
  async sync(): Promise<SyncResult> {
    if (!this.auth.isAuthenticated()) {
      throw new Error("Not connected to Google Drive — authenticate first.");
    }
    // Deduplicate concurrent sync requests; the caller can await the result.
    if (this.syncing) {
      throw new Error("Sync already in progress.");
    }
    this.syncing = true;
    this.lastError = null;
    try {
      const result = await this.runEngine();
      this.lastSyncTime = new Date().toISOString();
      await this.rebuildMetadataCache();
      return result;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  // Assembles and runs the SyncEngine for one full cycle.
  private async runEngine(): Promise<SyncResult> {
    const provider = createGoogleDriveProvider(this.auth);
    const manifestFs = new IdbManifestFileSystem();
    const manifest = await SyncManifest.load(manifestFs, PROVIDER_ID, PROVIDER_ID);
    const engine = new SyncEngine({
      provider,
      fs: this.fs,
      manifest,
      roots: ROOTS,
    });
    return engine.run();
  }

  // Re-populates the IDB metadata store from metadata.yaml files written by sync.
  private async rebuildMetadataCache(): Promise<void> {
    await rebuildFromFiles(
      (p) => this.fs.readFile(p),
      (p) => this.fs.listDir(p),
    );
  }
}
