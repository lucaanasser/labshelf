/** Moves paper folders between folders and sends them to the trash; sidecars stay, so a restored paper keeps its notes. */
import { describeError, MUTATIONS_MODULE, type BatchOutcome, type MutationContext, type PaperRef } from "./context.js";

export interface PaperMove {
  id: string;
  from: string;
  to: string;
}

export interface MoveOutcome extends BatchOutcome {
  /** Where each moved paper folder went, for the app to re-point its index. */
  moves: PaperMove[];
}

/**
 * Moves paper folders into `targetDir`; papers already there are skipped, name clashes fail.
 * @returns the moves made and the failures
 */
export async function movePapers(ctx: MutationContext, papers: PaperRef[], targetDir: string): Promise<MoveOutcome> {
  const outcome: MoveOutcome = { done: [], failed: [], moves: [] };
  if ((await ctx.fs.stat(targetDir))?.isDirectory !== true) {
    const error = `The folder "${ctx.paths.basename(targetDir)}" does not exist`;
    await ctx.logger.log("WARN", MUTATIONS_MODULE, "Paper move failed", { targetDir, message: error });
    return { ...outcome, failed: papers.map((paper) => ({ id: paper.id, error })) };
  }
  for (const paper of papers) {
    if (ctx.paths.dirname(paper.path) === targetDir) { continue; }
    const name = ctx.paths.basename(paper.path);
    const destination = ctx.paths.join(targetDir, name);
    try {
      if (await ctx.fs.exists(destination)) { throw new Error(`"${name}" already exists there`); }
      await ctx.fs.rename(paper.path, destination);
      outcome.done.push(paper.id);
      outcome.moves.push({ id: paper.id, from: paper.path, to: destination });
    } catch (error) {
      outcome.failed.push({ id: paper.id, error: describeError(error) });
      await ctx.logger.log("WARN", MUTATIONS_MODULE, "Paper move failed", { id: paper.id, targetDir, message: describeError(error) });
    }
  }
  if (outcome.done.length) {
    await ctx.logger.log("INFO", MUTATIONS_MODULE, "Papers moved", { ids: outcome.done, targetDir });
  }
  return outcome;
}

/**
 * Sends paper folders to the trash, one at a time; a paper that fails stays where it is.
 * @returns the papers trashed and the failures
 */
export async function trashPapers(ctx: MutationContext, papers: PaperRef[]): Promise<BatchOutcome> {
  const outcome: BatchOutcome = { done: [], failed: [] };
  for (const paper of papers) {
    try {
      await ctx.fs.trash(paper.path);
      outcome.done.push(paper.id);
    } catch (error) {
      outcome.failed.push({ id: paper.id, error: describeError(error) });
      await ctx.logger.log("WARN", MUTATIONS_MODULE, "Paper trash failed", { id: paper.id, message: describeError(error) });
    }
  }
  if (outcome.done.length) {
    await ctx.logger.log("INFO", MUTATIONS_MODULE, "Papers moved to trash", { ids: outcome.done });
  }
  return outcome;
}
