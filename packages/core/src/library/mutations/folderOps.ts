/** Creates, renames, moves and trashes the folders papers are grouped in; every path in and out is absolute. */
import { validateFolderName } from "../identity/index.js";
import { isUnderDir } from "../folderService.js";
import { MUTATIONS_MODULE, type MutationContext } from "./context.js";

/** @returns the new folder's path */
export async function createFolder(ctx: MutationContext, parentDir: string, name: string): Promise<string> {
  const trimmed = checkedName(name);
  const dir = ctx.paths.join(parentDir, trimmed);
  if (await ctx.fs.exists(dir)) { throw new Error(`"${trimmed}" already exists`); }
  await ctx.fs.mkdir(dir);
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Folder created", { dir });
  return dir;
}

/** @returns the folder's path after the rename; the same path when the name does not change */
export async function renameFolder(ctx: MutationContext, dir: string, newName: string): Promise<string> {
  refuseRoot(ctx, dir, "renamed");
  const trimmed = checkedName(newName);
  const to = ctx.paths.join(ctx.paths.dirname(dir), trimmed);
  if (to === dir) { return dir; }
  // On a case-insensitive disk (macOS) "ml" → "ML" finds the folder itself; that rename is allowed.
  const caseOnly = to.toLowerCase() === dir.toLowerCase();
  if (!caseOnly && (await ctx.fs.exists(to))) { throw new Error(`"${trimmed}" already exists there`); }
  await ctx.fs.rename(dir, to);
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Folder renamed", { from: dir, to });
  return to;
}

/** @returns the folder's path after the move; the same path when it already sits in `targetParentDir` */
export async function moveFolder(ctx: MutationContext, dir: string, targetParentDir: string): Promise<string> {
  refuseRoot(ctx, dir, "moved");
  if (isUnderDir(targetParentDir, dir, ctx.paths.sep)) { throw new Error("A folder cannot be moved into itself."); }
  if (ctx.paths.dirname(dir) === targetParentDir) { return dir; }
  const name = ctx.paths.basename(dir);
  const to = ctx.paths.join(targetParentDir, name);
  if (await ctx.fs.exists(to)) { throw new Error(`"${name}" already exists there`); }
  await ctx.fs.rename(dir, to);
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Folder moved", { from: dir, to });
  return to;
}

/** Sends a folder and everything in it to the trash; a failure is passed on with nothing deleted by this call. */
export async function trashFolder(ctx: MutationContext, dir: string): Promise<void> {
  refuseRoot(ctx, dir, "deleted");
  await ctx.fs.trash(dir);
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Folder moved to trash", { dir });
}

function refuseRoot(ctx: MutationContext, dir: string, verb: string): void {
  if (dir === ctx.papersRoot) { throw new Error(`The library root cannot be ${verb}`); }
}

function checkedName(name: string): string {
  const problem = validateFolderName(name);
  if (problem) { throw new Error(problem); }
  return name.trim();
}
