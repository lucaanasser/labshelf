/**
 * Resolves every well-known LabShelf path (papers, logs, sidecars, sync) from an arbitrary library root URI.
 *
 * @depends none (vscode API only)
 * @dependents core/logger.ts, core/paperService.ts, extension.ts, storage/data/libraryIndexer.ts, storage/index.ts, storage/paths/index.ts, storage/paths/workspacePaths.ts, sync/adapter/syncController.ts
 */
import * as vscode from "vscode";

export interface ILibraryPaths {
  researchRoot(): vscode.Uri;
  papersRoot(): vscode.Uri;
  logsRoot(): vscode.Uri;
  indexPath(): vscode.Uri;
  appLogPath(): vscode.Uri;
  paperDataRoot(): vscode.Uri;
  paperDataDir(paperId: string): vscode.Uri;
  paperDataPath(paperId: string): vscode.Uri;
  syncRoot(): vscode.Uri;
  syncDir(): vscode.Uri;
}

/**
 * Concrete ILibraryPaths implementation that computes every LabShelf path relative to a given root URI.
 * @usedBy extension.ts, storage/paths/index.ts, storage/paths/workspacePaths.ts
 */
export class LibraryPaths implements ILibraryPaths {
  constructor(private readonly root: vscode.Uri) {}

  /**
   * Returns the hidden .research/ directory that holds the index, logs, and sidecars.
   * @usedBy extension.ts, storage/data/paperDataStore.ts
   * @returns URI of .research/
   */
  researchRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research");
  }

  /**
   * Returns the user-visible papers/ directory where paper folders are stored.
   * @usedBy core/paperService.ts, extension.ts, storage/data/libraryIndexer.ts
   * @returns URI of papers/
   */
  papersRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, "papers");
  }

  /**
   * Returns the directory used for log files.
   * @usedBy core/logger.ts
   * @returns URI of .research/logs/
   */
  logsRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "logs");
  }

  /**
   * Returns the path of the SQLite index file.
   * @usedBy extension.ts
   * @returns URI of .research/index.sqlite
   */
  indexPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "index.sqlite");
  }

  /**
   * Returns the path of the main application log file.
   * @usedBy core/logger.ts
   * @returns URI of .research/logs/app.log
   */
  appLogPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "logs", "app.log");
  }

  // Root of the per-paper sidecar store. Each paper owns one folder keyed by
  // its stable id, independent of where its visible folder lives under papers/.
  paperDataRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "papers");
  }

  // Folder owning one paper's sidecar: .research/papers/<paperId>/
  paperDataDir(paperId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "papers", paperId);
  }

  // Sidecar JSON holding annotations, tags, notes and theme for one paper.
  paperDataPath(paperId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "papers", paperId, "data.json");
  }

  // Local per-provider sync state. Not synchronized; rebuilt per device.
  syncRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "sync");
  }

  // Alias for syncRoot, matching the paperDataDir naming convention.
  syncDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "sync");
  }
}
