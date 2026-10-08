/**
 * Writes a paper record to metadata.yaml and bib.bib under the ownership rules of the library-format and sync contracts:
 * tags, note and the reading status belong to whoever set them, and hasPdf is never stored.
 */
import type { PaperRecord, PaperStatus } from "../../model/index.js";
import { PDF_FILE } from "../layout.js";
import { describeError, MUTATIONS_MODULE, type MutationContext } from "./context.js";
import { statusOnDisk } from "./paperOnDisk.js";

export interface RecordWriteOptions {
  /** True only for an explicit status change; any other rewrite keeps the status metadata.yaml holds. */
  ownsStatus: boolean;
  /** Set to replace the file's tags; left out, the file's own tags stay. */
  tags?: string[];
  /** Set to replace the file's note; left out, the file's own note stays. */
  note?: string;
}

/**
 * Rewrites a paper's metadata.yaml and bib.bib from a record, typically one from an app's index.
 * @returns the record as written, with the status that went to disk
 */
export async function writePaperRecord(
  ctx: MutationContext,
  record: PaperRecord,
  options: RecordWriteOptions,
): Promise<PaperRecord> {
  const { tags: _tags, note: _note, hasPdf: _hasPdf, ...rest } = record;
  const status = options.ownsStatus ? record.status : await keptStatus(ctx, record);
  const owned: Pick<PaperRecord, "tags" | "note"> = {};
  if (options.tags !== undefined) { owned.tags = options.tags; }
  if (options.note !== undefined) { owned.note = options.note; }
  await ctx.artifacts.writePaperArtifacts(record.path, { ...rest, status, ...owned }, ctx.paths.join(record.path, PDF_FILE));
  return { ...record, status, ...owned };
}

// The terminal app or a sync may have changed the status after the index was built; the file's copy wins.
async function keptStatus(ctx: MutationContext, record: PaperRecord): Promise<PaperStatus> {
  let reason: string;
  try {
    const status = await statusOnDisk(ctx, record.path);
    if (status) { return status; }
    reason = "metadata.yaml holds no valid status";
  } catch (error) {
    reason = describeError(error);
  }
  await ctx.logger.log("WARN", MUTATIONS_MODULE, "Status on disk unreadable, keeping the indexed status", {
    id: record.id, status: record.status, reason,
  });
  return record.status;
}
