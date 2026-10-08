/**
 * Manages the LabShelf settings editor tab: it shows the current library root and Google
 * Drive connection state, and delegates every action back to the commands and callbacks
 * owned by the composition root.
 *
 * @depends sync/adapter/syncController.ts, ui/tabIcon.ts
 * @dependents ui/settings/index.ts, extension.ts
 */
import * as vscode from "vscode";
import type { SyncController } from "../../sync/adapter/syncController.js";
import { labshelfTabIcon } from "../tabIcon.js";

export interface SettingsPanelOptions {
  /** Current library root, or null while no library is configured. */
  getLibraryRoot: () => vscode.Uri | null;
  /** Active sync controller, or null while Drive sync has not been set up. */
  getSyncController: () => SyncController | null;
  /** Runs the library setup wizard and resolves to the new root, or undefined if cancelled. */
  reconfigureLibrary: () => Promise<vscode.Uri | undefined>;
}

export class SettingsWebviewPanel {
  public static currentPanel: SettingsWebviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _options: SettingsPanelOptions;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Reveals the existing settings panel if one is open, or creates a new one.
   * @usedBy extension.ts (labshelf.openSettings)
   * @returns void
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    options: SettingsPanelOptions,
  ): void {
    if (SettingsWebviewPanel.currentPanel) {
      SettingsWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      SettingsWebviewPanel.currentPanel._render();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "labshelfSettings",
      "LabShelf Settings",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );
    panel.iconPath = labshelfTabIcon(extensionUri);

    SettingsWebviewPanel.currentPanel = new SettingsWebviewPanel(panel, options);
  }

  private constructor(panel: vscode.WebviewPanel, options: SettingsPanelOptions) {
    this._panel = panel;
    this._options = options;

    this._panel.webview.onDidReceiveMessage(
      (msg: Record<string, unknown>) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    const controller = options.getSyncController();
    if (controller) {
      this._disposables.push(controller.onDidChangeStatus(() => this._render()));
    }

    this._render();
  }

  private async _handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg["command"]) {
      case "library.reconfigure":
        await this._options.reconfigureLibrary();
        break;
      case "sync.connect":
        await vscode.commands.executeCommand("labshelf.sync.connect");
        break;
      case "sync.now":
        await vscode.commands.executeCommand("labshelf.sync.now");
        break;
      case "sync.disconnect":
        await vscode.commands.executeCommand("labshelf.sync.disconnect");
        break;
      case "settings.openNative":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "labshelf",
        );
        break;
      default:
        return;
    }
    this._render();
  }

  private _render(): void {
    const root = this._options.getLibraryRoot();
    const controller = this._options.getSyncController();
    this._panel.webview.html = buildSettingsHtml({
      libraryRoot: root ? root.fsPath : null,
      connected: controller?.isConnected() ?? false,
      syncing: controller?.isSyncing() ?? false,
      lastSync: controller?.getLastSyncTime() ?? null,
    });
  }

  /**
   * Disposes the panel and every subscription held by it.
   * @usedBy vscode WebviewPanel onDidDispose
   * @returns void
   */
  public dispose(): void {
    SettingsWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

interface SettingsViewState {
  libraryRoot: string | null;
  connected: boolean;
  syncing: boolean;
  lastSync: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSettingsHtml(state: SettingsViewState): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const rootLabel = state.libraryRoot
    ? escapeHtml(state.libraryRoot)
    : "No library configured";
  const syncStatus = state.syncing
    ? "Syncing..."
    : state.connected
      ? state.lastSync
        ? `Connected — last sync: ${escapeHtml(state.lastSync)}`
        : "Connected to Google Drive"
      : "Not connected to Google Drive";
  const syncActions = state.connected
    ? `<button data-command="sync.now">Sync now</button>
       <button data-command="sync.disconnect">Disconnect</button>`
    : `<button data-command="sync.connect">Connect to Google Drive</button>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px 32px; }
  h1 { font-size: 1.4em; margin: 0 0 24px; }
  section { border-top: 1px solid var(--vscode-panel-border); padding: 16px 0; }
  h2 { font-size: 1em; margin: 0 0 8px; }
  p { margin: 0 0 12px; color: var(--vscode-descriptionForeground); word-break: break-all; }
  button { font-family: inherit; font-size: inherit; margin-right: 8px; padding: 4px 12px; border: none; cursor: pointer;
           color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <h1>LabShelf Settings</h1>

  <section>
    <h2>Library</h2>
    <p>${rootLabel}</p>
    <button data-command="library.reconfigure">Change library folder</button>
  </section>

  <section>
    <h2>Google Drive sync</h2>
    <p>${syncStatus}</p>
    ${syncActions}
  </section>

  <section>
    <h2>Preferences</h2>
    <p>Sync interval and AI options live in the VS Code settings UI.</p>
    <button data-command="settings.openNative">Open VS Code settings</button>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-command]');
      if (target) { vscode.postMessage({ command: target.dataset.command }); }
    });
  </script>
</body>
</html>`;
}
