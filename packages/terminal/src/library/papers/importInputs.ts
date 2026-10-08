/** Sorts what the user typed in "add" into PDF files, PDF URLs, identifiers and inputs there is nothing to import from. */
import * as path from "node:path";

import { detectIdentifiers, discoverPdfs, type DetectedIdentifier, type MutationContext } from "@labshelf/core";

export interface ImportItem {
  kind: "pdf" | "url" | "identifier" | "skipped";
  value: string;
}

/**
 * Normalizes input into something detectIdentifiers understands (bare arXiv ids, bare DOIs).
 * @returns the identifiers found, best first
 */
export function identifiersIn(input: string): DetectedIdentifier[] {
  const text = input.trim();
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(text)) { return [{ type: "arxiv", value: text.replace(/v\d+$/, "") }]; }
  if (/^10\.\d{4,9}\/\S+$/.test(text)) { return [{ type: "doi", value: text }]; }
  return detectIdentifiers({}, text);
}

/** @returns one item per PDF found under the inputs, per URL, per identifier and per input that is not importable */
export async function planImports(ctx: MutationContext, inputs: string[]): Promise<ImportItem[]> {
  const items: ImportItem[] = [];
  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) { continue; }
    const local = path.resolve(input.replace(/^~(?=$|\/)/, process.env["HOME"] ?? "~"));
    if (await ctx.fs.exists(local)) {
      const found = await discoverPdfs(ctx, [local]);
      items.push(...found.pdfs.map((value): ImportItem => ({ kind: "pdf", value })));
      items.push(...found.skipped.map((value): ImportItem => ({ kind: "skipped", value: input })));
    } else if (/^https?:\/\//i.test(input) && identifiersIn(input).length === 0) {
      items.push({ kind: "url", value: input });
    } else {
      items.push({ kind: "identifier", value: input });
    }
  }
  return items;
}
