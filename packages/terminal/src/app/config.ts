/**
 * The config file shared by the terminal app and the VS Code extension: ~/.config/labshelf/config.json. Both apps
 * read "libraryRoot" from it, so a library set up in either one is found by the other. The terminal keeps its own
 * preferences under "terminal"; keys it does not know (written by the VS Code extension) are preserved on save.
 *
 * Resolution order for the library: --library flag, LABSHELF_LIBRARY, config.json, none (the TUI then offers setup).
 *
 * @depends platform/dirs
 * @dependents main, cli/commands, app/context
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { writeFileAtomic } from "@labshelf/core/node";

import { configDir, expandHome } from "../platform/dirs.js";

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

export interface SharedConfig {
  version: 1;
  libraryRoot?: string;
  terminal?: TerminalPreferences;
  [key: string]: unknown;
}

export const CONFIG_FILE = "config.json";

/**
 * @usedBy loadConfig, saveConfig, cli where/doctor
 * @returns the absolute path of the shared config file
 */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDir(env), CONFIG_FILE);
}

/**
 * Reads the shared config; a missing or broken file reads as empty.
 * @usedBy resolveLibraryRoot, main
 * @returns the config
 */
export async function loadConfig(file = configPath()): Promise<SharedConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>), version: 1 } as SharedConfig;
    }
  } catch {
    // Absent or unreadable: start empty.
  }
  return { version: 1 };
}

/**
 * Merges a patch into the config file, keeping keys other apps wrote.
 * @usedBy cli init, ui setup
 * @returns the saved config
 */
export async function updateConfig(patch: Partial<SharedConfig>, file = configPath()): Promise<SharedConfig> {
  const current = await loadConfig(file);
  const next: SharedConfig = {
    ...current,
    ...patch,
    ...(patch.terminal ? { terminal: { ...(current.terminal ?? {}), ...patch.terminal } } : {}),
    version: 1,
  };
  await writeFileAtomic(file, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export interface LibraryRootResolution {
  root: string | undefined;
  source: "flag" | "env" | "config" | "none";
}

/**
 * Finds the library root to open.
 * @usedBy main
 * @returns the root (not yet validated) and where it came from
 */
export function resolveLibraryRoot(flag: string | undefined, env: NodeJS.ProcessEnv, config: SharedConfig): LibraryRootResolution {
  if (flag) { return { root: path.resolve(expandHome(flag)), source: "flag" }; }
  if (env["LABSHELF_LIBRARY"]) { return { root: path.resolve(expandHome(env["LABSHELF_LIBRARY"])), source: "env" }; }
  if (typeof config.libraryRoot === "string" && config.libraryRoot) {
    return { root: path.resolve(expandHome(config.libraryRoot)), source: "config" };
  }
  return { root: undefined, source: "none" };
}
