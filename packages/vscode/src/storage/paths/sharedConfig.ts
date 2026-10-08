/**
 * The config file LabShelf apps share on this computer: $XDG_CONFIG_HOME/labshelf/config.json (default
 * ~/.config/labshelf/config.json). The extension writes the library root there, so the terminal app (`labshelf`)
 * opens the same library, and reads it when VS Code has none yet, so a library set up in the terminal is found here.
 * Keys written by other apps (the terminal's "terminal" preferences) are preserved.
 *
 * node:fs is used directly: the file lives outside any workspace and must be written atomically.
 *
 * @depends node:fs, node:os, node:path
 * @dependents storage/paths/libraryLocation.ts
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * @usedBy readSharedLibraryRoot, writeSharedLibraryRoot
 * @returns the absolute path of the shared config file
 */
export function sharedConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
  return path.join(base, "labshelf", "config.json");
}

async function readConfig(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The library root recorded by any LabShelf app, when it is an absolute path.
 * @usedBy storage/paths/libraryLocation.ts (resolveLibraryRoot)
 * @returns the path, or undefined
 */
export async function readSharedLibraryRoot(file = sharedConfigPath()): Promise<string | undefined> {
  const root = (await readConfig(file))["libraryRoot"];
  return typeof root === "string" && path.isAbsolute(root) ? root : undefined;
}

/**
 * Records the library root for the other LabShelf apps, keeping every other key; a no-op when it is already recorded.
 * @usedBy storage/paths/libraryLocation.ts (persistLibraryRoot, mirrorLibraryRoot)
 * @returns void
 */
export async function writeSharedLibraryRoot(root: string, file = sharedConfigPath()): Promise<void> {
  const current = await readConfig(file);
  if (current["libraryRoot"] === root) { return; }
  const next = { ...current, version: 1, libraryRoot: root };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n");
  await fs.rename(tmp, file);
}
