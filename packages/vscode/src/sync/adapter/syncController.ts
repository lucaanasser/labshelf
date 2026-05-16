/**
 * Module: SyncController
 * Responsibility: Orchestrate sync lifecycle — auth, engine wiring, debounced
 *   auto-sync on library events, periodic polling, status bar feedback
 * Dependencies: vscode, GoogleDriveAuth, GoogleDriveProvider, SyncEngine,
 *   SyncManifest, VscodeLocalFileSystem, ILibraryPaths, ExtensionEventBus
 */
import * as path from "node:path";
import * as vscode from "vscode";

import type { ILibraryPaths } from "../../storage/paths/libraryPaths.js";
import type { ExtensionEventBus } from "../../core/eventBus.js";
import { GoogleDriveAuth } from "../auth/googleDriveAuth.js";
import { createGoogleDriveProvider } from "../drive/googleDriveProvider.js";
import { SyncEngine } from "../core/syncEngine.js";
import { SyncManifest } from "../core/syncManifest.js";
import { VscodeLocalFileSystem } from "./vscodeLocalFileSystem.js";
import type { SyncResult } from "../core/syncTypes.js";
import type { FolderNameMaps } from "../core/syncEngine.js";

const DEBOUNCE_MS = 30_000;
const PROVIDER_ID = "google-drive";

export class SyncController implements vscode.Disposable {
  private readonly auth: GoogleDriveAuth;
  private readonly localFs: VscodeLocalFileSystem;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly _onDidChangeStatus = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus: vscode.Event<void> = this._onDidChangeStatus.event;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private periodicTimer: ReturnType<typeof setInterval> | undefined;
  private syncing = false;
  private lastSyncTime: string | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly paths: ILibraryPaths,
    eventBus: ExtensionEventBus,
    /** Returns a paperId → title map used to name Drive folders. */
    private readonly getPaperTitles?: () => Promise<Map<string, string>>,
  ) {
    this.auth = new GoogleDriveAuth(context);
    this.localFs = new VscodeLocalFileSystem();

    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBar.command = "labshelf.sync.now";
    this.disposables.push(this.statusBar);

    // Debounce sync on library change events
    const scheduleSync = (): void => this.scheduleDebounce();
    eventBus.on("paper:added", scheduleSync);
    eventBus.on("paper:deleted", scheduleSync);
    eventBus.on("paper:updated", scheduleSync);
    eventBus.on("annotation:created", scheduleSync);
    eventBus.on("annotation:updated", scheduleSync);
    eventBus.on("annotation:deleted", scheduleSync);
  }

  async initialize(): Promise<void> {
    await this.auth.loadPersistedState();
    this.updateStatusBar();
    if (this.auth.isAuthenticated()) {
      this.startPeriodicSync();
    }
  }

  async connect(): Promise<void> {
    await this.auth.authenticate();
    this.updateStatusBar();
    this.startPeriodicSync();
    vscode.window.showInformationMessage("LabShelf: Conectado ao Google Drive.");
    await this.sync();
  }

  async disconnect(): Promise<void> {
    this.stopPeriodicSync();
    await this.auth.revoke();
    this.updateStatusBar();
    vscode.window.showInformationMessage("LabShelf: Desconectado do Google Drive.");
  }

  async sync(): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      vscode.window.showWarningMessage("LabShelf Sync: conecte ao Google Drive primeiro.");
      return;
    }
    this.syncing = true;
    this.statusBar.text = "$(sync~spin) LabShelf Sync";
    this.statusBar.show();
    this._onDidChangeStatus.fire();

    try {
      const result = await this.runEngine();
      this.lastSyncTime = new Date().toLocaleTimeString();
      this.reportResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`LabShelf Sync: ${msg}`);
      this.statusBar.text = "$(sync-ignored) LabShelf";
    } finally {
      this.syncing = false;
      this._onDidChangeStatus.fire();
    }
  }

  isConnected(): boolean {
    return this.auth.isAuthenticated();
  }

  isSyncing(): boolean {
    return this.syncing;
  }

  getLastSyncTime(): string | null {
    return this.lastSyncTime;
  }

  private async buildFolderNames(): Promise<FolderNameMaps | undefined> {
    if (!this.getPaperTitles) return undefined;
    const titles = await this.getPaperTitles();
    const localToRemote = new Map<string, string>();
    const remoteToLocal = new Map<string, string>();
    for (const [id, raw] of titles) {
      const display = raw.trim().replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 255) || id;
      localToRemote.set(id, display);
      remoteToLocal.set(display, id);
    }
    return { localToRemote, remoteToLocal };
  }

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
        `LabShelf Sync: ${conflicts.length} conflito(s) detectado(s). Arquivos duplicados com sufixo "(conflito)".`,
      );
    } else if (total > 0) {
      vscode.window.setStatusBarMessage(`LabShelf Sync: ${total} arquivo(s) sincronizado(s)`, 4000);
    }
  }

  private scheduleDebounce(): void {
    if (!this.auth.isAuthenticated()) { return; }
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => { void this.sync(); }, DEBOUNCE_MS);
  }

  private startPeriodicSync(): void {
    this.stopPeriodicSync();
    const intervalMin = vscode.workspace
      .getConfiguration("labshelf")
      .get<number>("sync.autoSyncIntervalMinutes", 15);
    this.periodicTimer = setInterval(() => { void this.sync(); }, intervalMin * 60_000);
  }

  private stopPeriodicSync(): void {
    if (this.periodicTimer !== undefined) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }
  }

  private updateStatusBar(): void {
    if (this.auth.isAuthenticated()) {
      this.statusBar.text = "$(cloud) LabShelf";
      this.statusBar.tooltip = "LabShelf: sincronizado com Google Drive. Clique para sincronizar.";
      this.statusBar.command = "labshelf.sync.now";
      this.statusBar.show();
    } else {
      this.statusBar.text = "$(cloud-upload) LabShelf";
      this.statusBar.tooltip = "LabShelf: sem sincronizacao. Clique para conectar ao Drive.";
      this.statusBar.command = "labshelf.sync.connect";
      this.statusBar.show();
    }
    this._onDidChangeStatus.fire();
  }

  dispose(): void {
    clearTimeout(this.debounceTimer);
    this.stopPeriodicSync();
    this._onDidChangeStatus.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
