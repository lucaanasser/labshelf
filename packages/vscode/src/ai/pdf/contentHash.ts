/**
 * Produces a stable content hash for a paper's PDF so the indexer can skip
 * unchanged inputs across reruns. Hash is over the raw bytes; tiny but enough
 * to detect any modification.
 *
 * @depends node:crypto
 * @dependents indexer/aiIndexer.ts
 */
import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { FileSystemService } from "../../storage/fileSystemService.js";

/**
 * Computes a SHA-1 hex digest of the file at `uri`.
 *
 * @usedBy aiIndexer idempotency check
 * @returns 40-character lowercase hex string.
 */
export async function hashFile(
  uri: vscode.Uri,
  fileSystem: FileSystemService,
): Promise<string> {
  const bytes = await fileSystem.readBinary(uri);
  return createHash("sha1").update(bytes).digest("hex");
}
