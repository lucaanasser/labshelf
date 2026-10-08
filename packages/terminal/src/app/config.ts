/**
 * The terminal's view of the shared config file (see core's sharedConfig): its preferences and how it picks the library.
 * Resolution order for the library: --library flag, LABSHELF_LIBRARY, config.json, none (the TUI then offers setup).
 */
import * as path from "node:path";

import type { SharedConfig } from "@labshelf/core";
import { loadSharedConfig } from "@labshelf/core/node";

import { expandHome } from "../platform/dirs.js";

export type SortKey = "title" | "year" | "author" | "status" | "modified";

export interface TerminalPreferences {
  /** Command used to open PDFs instead of the system default, e.g. "zathura" or "open -a Skim". */
  pdfViewer?: string;
  /** "auto" | "kitty" | "iterm" | "off". */
  images?: string;
  sort?: SortKey;
  sortReverse?: boolean;
  /** Minutes between automatic syncs while the TUI is open; 0 disables. */
  autoSyncMinutes?: number;
}

/** The shared config file as the terminal sees it: its own "terminal" preferences are typed, other keys are not. */
export type TerminalConfig = SharedConfig & { terminal?: TerminalPreferences };

/**
 * Reads the shared config; a missing or broken file reads as empty. The terminal namespace is not validated.
 * @returns the config
 */
export async function loadTerminalConfig(): Promise<TerminalConfig> {
  return (await loadSharedConfig()) as TerminalConfig;
}

export interface LibraryRootResolution {
  root: string | undefined;
  source: "flag" | "env" | "config" | "none";
}

/**
 * Finds the library root to open.
 * @returns the root (not yet validated) and where it came from
 */
export function resolveLibraryRoot(flag: string | undefined, env: NodeJS.ProcessEnv, config: TerminalConfig): LibraryRootResolution {
  if (flag) { return { root: path.resolve(expandHome(flag)), source: "flag" }; }
  if (env["LABSHELF_LIBRARY"]) { return { root: path.resolve(expandHome(env["LABSHELF_LIBRARY"])), source: "env" }; }
  if (typeof config.libraryRoot === "string" && config.libraryRoot) {
    return { root: path.resolve(expandHome(config.libraryRoot)), source: "config" };
  }
  return { root: undefined, source: "none" };
}
