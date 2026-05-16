/**
 * Module: Library Paths
 * Responsibility: Resolve LabShelf folder structure from an arbitrary root URI
 * Dependencies: vscode
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

export class LibraryPaths implements ILibraryPaths {
  constructor(private readonly root: vscode.Uri) {}

  researchRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research");
  }

  papersRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, "papers");
  }

  logsRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "logs");
  }

  indexPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".research", "index.sqlite");
  }

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
