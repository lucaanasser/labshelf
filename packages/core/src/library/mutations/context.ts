/** What every library mutation runs over: the injected ports and the shapes of its results. */
import type { PaperRecord } from "../../model/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";

/** Path arithmetic in the app's path style; Node's `path` module satisfies it as is. */
export interface PathOps {
  readonly sep: string;
  join(...parts: string[]): string;
  dirname(target: string): string;
  basename(target: string, ext?: string): string;
}

/** Writes metadata.yaml and bib.bib for a paper; the core BibTeXService satisfies it. */
export interface PaperArtifactWriter {
  writePaperArtifacts(folder: string, paper: PaperRecord, sourceFileName: string): Promise<void>;
}

export interface MutationContext {
  fs: LibraryFileSystem;
  paths: PathOps;
  artifacts: PaperArtifactWriter;
  logger: ILogger;
  /** The papers/ folder: folder operations refuse to rename, move or trash it. */
  papersRoot: string;
  /** ISO timestamp for text-layer verdicts; the wall clock when absent. */
  now?: () => string;
}

/** A paper as the app's index knows it: enough to find its folder. */
export interface PaperRef {
  id: string;
  path: string;
}

export interface BatchOutcome {
  done: string[];
  failed: Array<{ id: string; error: string }>;
}

export const MUTATIONS_MODULE = "library/mutations";

/** @returns the message of an error, or its string form */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
