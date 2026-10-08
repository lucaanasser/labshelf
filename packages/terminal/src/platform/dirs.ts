/**
 * Per-user cache directory for the terminal app, following XDG on every Unix (as yazi, gh and most CLIs do):
 * $XDG_CACHE_HOME/labshelf (default ~/Library/Caches/labshelf on macOS, ~/.cache/labshelf elsewhere).
 */
import * as os from "node:os";
import * as path from "node:path";

/**
 * @returns the LabShelf cache directory
 */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["XDG_CACHE_HOME"]) { return path.join(env["XDG_CACHE_HOME"], "labshelf"); }
  if (process.platform === "darwin") { return path.join(os.homedir(), "Library", "Caches", "labshelf"); }
  return path.join(os.homedir(), ".cache", "labshelf");
}

/**
 * Expands a leading ~ to the home directory.
 * @returns the expanded path
 */
export function expandHome(p: string): string {
  if (p === "~") { return os.homedir(); }
  if (p.startsWith("~/")) { return path.join(os.homedir(), p.slice(2)); }
  return p;
}
