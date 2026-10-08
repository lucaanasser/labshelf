/**
 * Produces a stable content hash for a paper's PDF so the indexer can skip
 * unchanged inputs across reruns. Hash is over the raw bytes; tiny but enough
 * to detect any modification.
 */
import { createHash } from "node:crypto";
import * as vscode from "vscode";
import type { LocalFileSystem } from "@labshelf/core";

/**
 * Computes a SHA-1 hex digest of the file at `uri`.
 *
 * @returns 40-character lowercase hex string.
 */
export async function hashFile(
  uri: vscode.Uri,
  fileSystem: Pick<LocalFileSystem, "readFile">,
): Promise<string> {
  const bytes = await fileSystem.readFile(uri.fsPath);
  return createHash("sha1").update(bytes).digest("hex");
}
