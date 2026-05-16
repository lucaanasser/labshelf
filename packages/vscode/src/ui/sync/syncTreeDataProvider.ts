/**
 * Module: SyncTreeDataProvider
 * Responsibility: Tree data provider for the labshelf.activity view — shows
 *   Google Drive connection status and action items (connect, sync, disconnect).
 * Dependencies: vscode, SyncController
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

  getTreeItem(element: SyncTreeItem): SyncTreeItem {
    return element;
  }

  getChildren(): SyncTreeItem[] {
    if (this.controller.isSyncing()) {
      return [new SyncTreeItem("Sincronizando...", "status", "sync~spin")];
    }

    if (this.controller.isConnected()) {
      const lastSync = this.controller.getLastSyncTime();
      const statusLabel = lastSync
        ? `Ultima sincronizacao: ${lastSync}`
        : "Conectado ao Google Drive";
      return [
        new SyncTreeItem(statusLabel, "status", "cloud"),
        new SyncTreeItem(
          "Sincronizar agora",
          "action-sync",
          "sync",
          "labshelf.sync.now",
        ),
        new SyncTreeItem(
          "Desconectar",
          "action-disconnect",
          "circle-slash",
          "labshelf.sync.disconnect",
        ),
      ];
    }

    return [
      new SyncTreeItem("Nao conectado ao Drive", "status", "cloud-upload"),
      new SyncTreeItem(
        "Conectar ao Google Drive",
        "action-connect",
        "link",
        "labshelf.sync.connect",
      ),
    ];
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
