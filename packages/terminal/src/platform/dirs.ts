/**
 * Per-user directories for the terminal app, following XDG on every Unix (as yazi, gh and most CLIs do):
 * config in $XDG_CONFIG_HOME/labshelf (default ~/.config/labshelf), caches in $XDG_CACHE_HOME/labshelf (default
 * ~/Library/Caches/labshelf on macOS, ~/.cache/labshelf elsewhere).
 *
 * @depends none
 * @dependents app/config, sync/tokenStore, preview/thumbnails
 */
import * as os from "node:os";
import * as path from "node:path";

/**
 * @usedBy app/config, sync/tokenStore
 * @returns the LabShelf config directory
 */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
  return path.join(base, "labshelf");
}

/**
 * @usedBy preview/thumbnails
 * @returns the LabShelf cache directory
 */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["XDG_CACHE_HOME"]) { return path.join(env["XDG_CACHE_HOME"], "labshelf"); }
  if (process.platform === "darwin") { return path.join(os.homedir(), "Library", "Caches", "labshelf"); }
  return path.join(os.homedir(), ".cache", "labshelf");
}

/**
 * Expands a leading ~ to the home directory.
 * @usedBy app/config, cli, ui prompts
 * @returns the expanded path
 */
export function expandHome(p: string): string {
  if (p === "~") { return os.homedir(); }
  if (p.startsWith("~/")) { return path.join(os.homedir(), p.slice(2)); }
  return p;
}
