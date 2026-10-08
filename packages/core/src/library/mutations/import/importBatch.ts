/** Imports several PDFs in a row, each one seeing the ids and DOIs the earlier ones took. */
import type { MutationContext } from "../context.js";
import { importPdf, type ImportDeps, type ImportOutcome } from "./paperImport.js";
import { discoverPdfs } from "./pdfDiscovery.js";

export interface ImportProgress {
  /** 1-based position of the file about to be imported. */
  index: number;
  total: number;
  input: string;
}

/** @returns one outcome per file, in order */
export async function importPdfs(
  ctx: MutationContext,
  deps: ImportDeps,
  files: string[],
  targetDir: string,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportOutcome[]> {
  const claimedIds: string[] = [];
  const claimedDois = new Map<string, string>();
  const batchDeps: ImportDeps = {
    parse: deps.parse,
    findByDoi: (doi) => deps.findByDoi(doi) ?? claimedDois.get(doi.toLowerCase()),
    takenIds: () => [...deps.takenIds(), ...claimedIds],
  };
  const outcomes: ImportOutcome[] = [];
  for (const [position, file] of files.entries()) {
    onProgress?.({ index: position + 1, total: files.length, input: file });
    const outcome = await importPdf(ctx, batchDeps, file, targetDir);
    if (outcome.status === "added") {
      claimedIds.push(outcome.record.id);
      if (outcome.record.doi) { claimedDois.set(outcome.record.doi.toLowerCase(), outcome.record.id); }
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

/**
 * Imports picked files and folders: folders are searched for PDFs, and inputs that are neither file nor folder come
 * back as skipped.
 * @returns one outcome per PDF found, then one per skipped input
 */
export async function importPaths(
  ctx: MutationContext,
  deps: ImportDeps,
  inputs: string[],
  targetDir: string,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportOutcome[]> {
  const { pdfs, skipped } = await discoverPdfs(ctx, inputs);
  const outcomes = await importPdfs(ctx, deps, pdfs, targetDir, onProgress);
  return [...outcomes, ...skipped.map((input): ImportOutcome => ({ status: "skipped", input }))];
}
