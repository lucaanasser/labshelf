/** Reads a paper as its folder holds it right now, since another app or a sync may have changed it since the last scan. */
import { isPaperStatus, type PaperRecord, type PaperStatus } from "../../model/index.js";
import { METADATA_FILE, PDF_FILE } from "../layout.js";
import { paperRecordFromMetadata, parsePaperMetadata } from "../paperMetadata.js";
import type { MutationContext } from "./context.js";

/** @returns the paper in `folder`, or undefined when its metadata.yaml is missing or not a mapping */
export async function readPaperOnDisk(ctx: MutationContext, folder: string): Promise<PaperRecord | undefined> {
  const meta = await readMetadata(ctx, folder);
  if (!meta) { return undefined; }
  const pdf = await ctx.fs.stat(ctx.paths.join(folder, PDF_FILE));
  return paperRecordFromMetadata(meta, { id: ctx.paths.basename(folder), path: folder, hasPdf: pdf?.isFile === true });
}

/** @returns the reading status metadata.yaml holds, or undefined when it cannot be read or holds none */
export async function statusOnDisk(ctx: MutationContext, folder: string): Promise<PaperStatus | undefined> {
  const status = (await readMetadata(ctx, folder))?.["status"];
  return isPaperStatus(status) ? status : undefined;
}

async function readMetadata(ctx: MutationContext, folder: string): Promise<Record<string, unknown> | undefined> {
  const file = ctx.paths.join(folder, METADATA_FILE);
  if (!(await ctx.fs.exists(file))) { return undefined; }
  return parsePaperMetadata(await ctx.fs.readText(file));
}
