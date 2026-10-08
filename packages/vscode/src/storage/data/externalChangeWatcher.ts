/**
 * Notices library changes made outside this VS Code window — by the terminal app, a sync it ran, another window, or a
 * file manager — and lets the extension re-index, so papers added, edited, moved or removed elsewhere appear without a
 * reload. Watches papers/** and the sidecars; a burst of events (a sync pulling twenty papers) costs one re-index.
 *
 * Also owns the reconciliation the indexer does not do: papers whose folder disappeared from disk are dropped from the
 * index (the indexer only upserts).
 */
import * as vscode from "vscode";

import { SIDECAR_FILE, type LibraryLayout, type PaperRecord } from "@labshelf/core";

const DEBOUNCE_MS = 1_000;

export class ExternalChangeWatcher implements vscode.Disposable {
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(paths: LibraryLayout<vscode.Uri>, private readonly onChange: () => void, private readonly debounceMs = DEBOUNCE_MS) {
    const patterns = [
      new vscode.RelativePattern(paths.papersRoot(), "**"),
      new vscode.RelativePattern(paths.paperDataRoot(), `**/${SIDECAR_FILE}`),
    ];
    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const schedule = (uri: vscode.Uri): void => this.schedule(uri);
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      this.watchers.push(watcher);
    }
  }

  private schedule(uri: vscode.Uri): void {
    // The terminal app's atomic writes pass through hidden temp files; they are not changes of their own.
    const name = uri.fsPath.split(/[\\/]/).pop() ?? "";
    if ((name.startsWith(".") && name.endsWith(".tmp")) || name === ".DS_Store") { return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(), this.debounceMs);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const watcher of this.watchers) { watcher.dispose(); }
  }
}

/**
 * Ids of indexed papers whose folder no longer holds a metadata.yaml.
 * @returns the ids to drop from the index
 */
export async function findMissingPapers(
  papers: PaperRecord[],
  hasMetadata: (paperFolder: string) => Promise<boolean>,
): Promise<string[]> {
  const missing: string[] = [];
  for (const paper of papers) {
    if (!(await hasMetadata(paper.path))) { missing.push(paper.id); }
  }
  return missing;
}
