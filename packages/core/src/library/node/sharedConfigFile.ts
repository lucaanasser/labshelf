/** Reads and writes the shared config file in $XDG_CONFIG_HOME/labshelf (default ~/.config/labshelf). */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "../../ports/index.js";
import {
  mergeSharedConfig, parseSharedConfig, serializeSharedConfig, type SharedConfig, type SharedConfigPatch,
} from "../sharedConfig.js";
import { writeFileAtomic } from "./atomicWrite.js";

/** @returns the LabShelf config directory; an empty XDG_CONFIG_HOME counts as unset */
export function sharedConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
  return path.join(base, "labshelf");
}

/** @returns the absolute path of the shared config file */
export function sharedConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(sharedConfigDir(env), "config.json");
}

// A file that cannot be read (permissions, a directory in its place) reads as empty so the apps still start;
// the logger, when given, records why.
async function readText(file: string, logger?: ILogger): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await logger?.error("sharedConfig", error, { file, action: "read" });
    }
    return undefined;
  }
}

/** @returns the config; a missing, unreadable or corrupt file reads as empty */
export async function loadSharedConfig(file = sharedConfigPath(), logger?: ILogger): Promise<SharedConfig> {
  return parseSharedConfig((await readText(file, logger)) ?? "");
}

/**
 * Merges a patch into the file, keeping the keys other apps wrote, and writes atomically only when the text changes.
 * @returns the merged config
 */
export async function updateSharedConfig(
  patch: SharedConfigPatch,
  file = sharedConfigPath(),
  logger?: ILogger,
): Promise<SharedConfig> {
  const text = await readText(file, logger);
  const next = mergeSharedConfig(parseSharedConfig(text ?? ""), patch);
  const nextText = serializeSharedConfig(next);
  if (nextText !== text) { await writeFileAtomic(file, nextText); }
  return next;
}

/** @returns the library root recorded by any app, when it is an absolute path */
export async function readSharedLibraryRoot(file = sharedConfigPath(), logger?: ILogger): Promise<string | undefined> {
  const root = (await loadSharedConfig(file, logger)).libraryRoot;
  return typeof root === "string" && path.isAbsolute(root) ? root : undefined;
}
