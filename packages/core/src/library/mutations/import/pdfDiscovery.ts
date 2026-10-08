/** Expands what the user picked for import (files and folders) into the PDF files to import. */
import { describeError, MUTATIONS_MODULE, type MutationContext } from "../context.js";

export interface PdfDiscovery {
  /** Files picked directly, whatever their extension, and the .pdf files inside picked folders. */
  pdfs: string[];
  /** Inputs that are neither a file nor a folder: missing paths and symlinks. */
  skipped: string[];
}

/** @returns the PDFs to import, in input order with each folder's files sorted, and the skipped inputs */
export async function discoverPdfs(ctx: MutationContext, inputs: string[]): Promise<PdfDiscovery> {
  const found: PdfDiscovery = { pdfs: [], skipped: [] };
  for (const input of inputs) {
    const stat = await ctx.fs.stat(input);
    if (stat?.isDirectory) {
      found.pdfs.push(...(await pdfsUnder(ctx, input)).sort());
    } else if (stat?.isFile) {
      found.pdfs.push(input);
    } else {
      found.skipped.push(input);
    }
  }
  return found;
}

// Dot entries are hidden folders and system files; a symlink stats as neither file nor folder and is left out.
async function pdfsUnder(ctx: MutationContext, dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await ctx.fs.listDir(dir);
  } catch (error) {
    await ctx.logger.log("WARN", MUTATIONS_MODULE, "Import skipped a folder it could not read", {
      dir, message: describeError(error),
    });
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith(".")) { continue; }
    const child = ctx.paths.join(dir, name);
    const stat = await ctx.fs.stat(child);
    if (stat?.isDirectory) {
      out.push(...(await pdfsUnder(ctx, child)));
    } else if (stat?.isFile && name.toLowerCase().endsWith(".pdf")) {
      out.push(child);
    }
  }
  return out;
}
