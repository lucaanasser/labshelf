/** Changes the fields the user owns on papers (reading status, tags, note), reading each paper from disk first. */
import type { PaperRecord, PaperStatus } from "../../model/index.js";
import { normalizeTags } from "../identity/index.js";
import { describeError, MUTATIONS_MODULE, type BatchOutcome, type MutationContext, type PaperRef } from "./context.js";
import { readPaperOnDisk } from "./paperOnDisk.js";
import { writePaperRecord } from "./paperRecordWrite.js";

export interface PaperFieldsPatch {
  status?: PaperStatus;
  tags?: string[];
  note?: string;
}

export interface FieldsBatchOutcome extends BatchOutcome {
  /** The records written, for the app to put in its index. */
  records: PaperRecord[];
}

/**
 * Applies a patch to the paper in `folder`; an unchanged patch writes nothing.
 * @returns the paper after the patch, or undefined when the folder holds no paper
 */
export async function updatePaperFields(
  ctx: MutationContext,
  folder: string,
  patch: PaperFieldsPatch,
): Promise<PaperRecord | undefined> {
  const current = await readPaperOnDisk(ctx, folder);
  return current && applyPatch(ctx, current, patch);
}

/** @returns the papers changed, with their records, and the failures */
export function setPaperStatus(ctx: MutationContext, papers: PaperRef[], status: PaperStatus): Promise<FieldsBatchOutcome> {
  return eachPaper(ctx, papers, (current) => applyPatch(ctx, current, { status }));
}

/**
 * Adds and removes tags on several papers, keeping each paper's other tags as its file holds them.
 * @returns the papers changed, with their records, and the failures
 */
export function editPaperTags(
  ctx: MutationContext,
  papers: PaperRef[],
  add: string[],
  remove: string[],
): Promise<FieldsBatchOutcome> {
  const removeKeys = new Set(remove.map((tag) => tag.trim().toLowerCase()));
  return eachPaper(ctx, papers, (current) => {
    const kept = (current.tags ?? []).filter((tag) => !removeKeys.has(tag.toLowerCase()));
    return applyPatch(ctx, current, { tags: [...kept, ...add] });
  });
}

async function applyPatch(ctx: MutationContext, current: PaperRecord, patch: PaperFieldsPatch): Promise<PaperRecord> {
  const owned: Pick<PaperRecord, "tags" | "note"> = {};
  if (patch.tags !== undefined) { owned.tags = normalizeTags(patch.tags); }
  if (patch.note !== undefined) { owned.note = patch.note; }
  const next: PaperRecord = { ...current, ...(patch.status ? { status: patch.status } : {}), ...owned };
  const changed = next.status !== current.status
    || (owned.tags !== undefined && owned.tags.join("\n") !== (current.tags ?? []).join("\n"))
    || (owned.note !== undefined && owned.note !== (current.note ?? ""));
  if (!changed) { return current; }
  // `current` was just read from the file, so its status is the file's: writing it back changes nothing.
  const written = await writePaperRecord(ctx, next, { ownsStatus: true, ...owned });
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Paper updated", { id: current.id, fields: Object.keys(patch) });
  return written;
}

async function eachPaper(
  ctx: MutationContext,
  papers: PaperRef[],
  run: (current: PaperRecord) => Promise<PaperRecord>,
): Promise<FieldsBatchOutcome> {
  const outcome: FieldsBatchOutcome = { done: [], failed: [], records: [] };
  for (const paper of papers) {
    try {
      const current = await readPaperOnDisk(ctx, paper.path);
      if (!current) { throw new Error("Paper not found"); }
      outcome.records.push(await run(current));
      outcome.done.push(paper.id);
    } catch (error) {
      outcome.failed.push({ id: paper.id, error: describeError(error) });
      await ctx.logger.log("WARN", MUTATIONS_MODULE, "Paper update failed", { id: paper.id, message: describeError(error) });
    }
  }
  return outcome;
}
