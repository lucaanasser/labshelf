/**
 * Tree data provider for the labshelf.activity view, rendering Google Drive connection status and action items (connect, sync, disconnect).
 *
 * @depends sync/adapter/syncController.ts
 * @dependents ui/sync/index.ts, extension.ts
 */
import * as vscode from "vscode";
import type { SyncController } from "../../sync/adapter/syncController.js";

type SyncItemKind = "status" | "action-connect" | "action-sync" | "action-disconnect";

class SyncTreeItem extends vscode.TreeItem {
  constructor(label: string, kind: SyncItemKind, icon: string, cmd?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = kind;
    if (cmd) {
      this.command = { command: cmd, title: label };
    }
  }
}

export class SyncTreeDataProvider
  implements vscode.TreeDataProvider<SyncTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly controller: SyncController) {
    this.subscription = controller.onDidChangeStatus(() =>
      this._onDidChangeTreeData.fire(),
    );
  }

  /**
   * Returns the tree item unchanged, as SyncTreeItem already extends vscode.TreeItem.
   * @usedBy vscode TreeDataProvider API
   * @returns The same SyncTreeItem passed in.
   */
  getTreeItem(element: SyncTreeItem): SyncTreeItem {
    return element;
  }

  /**
   * Returns the list of tree items representing the current sync state (syncing, connected, or disconnected).
   * @usedBy vscode TreeDataProvider API
   * @returns An array of SyncTreeItem nodes for the activity view.
   */
  getChildren(): SyncTreeItem[] {
    if (this.controller.isSyncing()) {
      return [new SyncTreeItem("Syncing...", "status", "sync~spin")];
    }

    if (this.controller.isConnected()) {
      const lastSync = this.controller.getLastSyncTime();
      const statusLabel = lastSync
        ? `Last sync: ${lastSync}`
        : "Connected to Google Drive";
      return [
        new SyncTreeItem(statusLabel, "status", "cloud"),
        new SyncTreeItem(
          "Sync now",
          "action-sync",
          "sync",
          "labshelf.sync.now",
        ),
        new SyncTreeItem(
          "Disconnect",
          "action-disconnect",
          "circle-slash",
          "labshelf.sync.disconnect",
        ),
      ];
    }

    return [
      new SyncTreeItem("Not connected to Drive", "status", "cloud-upload"),
      new SyncTreeItem(
        "Connect to Google Drive",
        "action-connect",
        "link",
        "labshelf.sync.connect",
      ),
    ];
  }

  /**
   * Disposes the sync status subscription and the onDidChangeTreeData event emitter.
   * @usedBy extension.ts (via context.subscriptions)
   * @returns void
   */
  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
