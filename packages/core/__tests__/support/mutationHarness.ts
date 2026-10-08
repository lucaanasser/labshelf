/** A MutationContext over the in-memory file system and the real BibTeXService, with a recording logger. */
import { stringify, parse } from "yaml";

import { BibTeXService, posixPathOps, type ILogger, type MutationContext } from "@labshelf/core";

import { MemoryLibraryFs } from "./memoryLibraryFs";

export const PAPERS = "/lib/papers";

export interface LogCall { level: string; message: string; context: Record<string, unknown> | undefined }

export interface MutationHarness {
  fs: MemoryLibraryFs;
  ctx: MutationContext;
  logs: LogCall[];
  /** Writes <folder>/metadata.yaml (and paper.pdf unless `pdf` is false); returns the folder. */
  seedPaper(folder: string, meta: Record<string, unknown>, options?: { pdf?: boolean }): Promise<string>;
  readMeta(folder: string): Promise<Record<string, unknown>>;
  readBib(folder: string): Promise<string>;
}

/** Bytes that pass the %PDF- check. */
export function pdfBytes(body = "fake"): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF\n`);
}

export function makeHarness(): MutationHarness {
  const fs = new MemoryLibraryFs();
  const logs: LogCall[] = [];
  const logger: ILogger = {
    log: async (level, _module, message, context) => { logs.push({ level, message, context }); },
    error: async (_module, error, context) => { logs.push({ level: "ERROR", message: String(error), context }); },
  };
  const ctx: MutationContext = {
    fs, paths: posixPathOps, artifacts: new BibTeXService(fs), logger, papersRoot: PAPERS,
    now: () => "2026-01-01T00:00:00.000Z",
  };
  void fs.mkdir(PAPERS);
  return {
    fs, ctx, logs,
    async seedPaper(folder, meta, options = {}) {
      await fs.writeText(`${folder}/metadata.yaml`, stringify(meta));
      if (options.pdf !== false) { await fs.writeFile(`${folder}/paper.pdf`, pdfBytes()); }
      return folder;
    },
    async readMeta(folder) { return parse(await fs.readText(`${folder}/metadata.yaml`)) as Record<string, unknown>; },
    async readBib(folder) { return fs.readText(`${folder}/bib.bib`); },
  };
}
