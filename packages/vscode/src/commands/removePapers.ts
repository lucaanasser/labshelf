/** Removes papers from the library after asking whether their folders also go to the trash. */
import * as vscode from "vscode";

import type { PaperRecord } from "@labshelf/core";
import type { PaperService } from "../core/index.js";

const REMOVE_ONLY = "Remove only";
const REMOVE_AND_TRASH = "Remove + delete files";

/** A paper whose folder cannot be trashed stays in the list, and the user is told why. */
export async function removePapers(paperService: PaperService, papers: PaperRecord[]): Promise<void> {
  if (papers.length === 0) { return; }
  const what = papers.length === 1 ? `"${papers[0]!.title}"` : `${papers.length} papers`;
  const choice = await vscode.window.showWarningMessage(
    `Remove ${what} from library?`,
    { modal: true },
    REMOVE_ONLY,
    REMOVE_AND_TRASH,
  );
  if (choice === REMOVE_ONLY) {
    for (const paper of papers) { await paperService.removeFromIndex(paper.id); }
    vscode.window.setStatusBarMessage(`LabShelf: removed ${what}`, 3000);
  } else if (choice === REMOVE_AND_TRASH) {
    const outcome = await paperService.trashPapers(papers.map((paper) => paper.id));
    const firstFailure = outcome.failed[0];
    if (firstFailure) {
      const title = papers.find((paper) => paper.id === firstFailure.id)?.title ?? firstFailure.id;
      const others = outcome.failed.length > 1 ? ` (and ${outcome.failed.length - 1} more)` : "";
      void vscode.window.showErrorMessage(
        `LabShelf: Could not move "${title}"${others} to the trash — ${firstFailure.error}`,
      );
    }
    if (outcome.done.length > 0) {
      vscode.window.setStatusBarMessage(`LabShelf: removed ${outcome.done.length === 1 && !firstFailure ? what : `${outcome.done.length} papers`}`, 3000);
    }
  }
}
