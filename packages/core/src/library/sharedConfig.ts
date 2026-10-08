/** The config file LabShelf apps share on this computer: its shape, parsing, merging and serialization. */

export const SHARED_CONFIG_VERSION = 1;

/** Every app owns its own namespace key (e.g. "terminal") and keeps the keys it does not know. */
export interface SharedConfig {
  version: 1;
  libraryRoot?: string;
  [namespace: string]: unknown;
}

/** A change to apply: a key set to undefined is removed. */
export interface SharedConfigPatch {
  libraryRoot?: string | undefined;
  [namespace: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses the file text; anything that is not a JSON object reads as an empty config.
 * @returns the config, with every key the file holds and version forced to 1
 */
export function parseSharedConfig(text: string): SharedConfig {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isPlainObject(parsed)) { return { ...parsed, version: SHARED_CONFIG_VERSION }; }
  } catch {
    // A corrupt file reads as empty; the next update rewrites it.
  }
  return { version: SHARED_CONFIG_VERSION };
}

/**
 * Applies a patch: a key whose current and patched values are both objects merges one level deep, so an app
 * updating one preference keeps the others; a key patched to undefined is removed.
 * @returns the merged config
 */
export function mergeSharedConfig(current: SharedConfig, patch: SharedConfigPatch): SharedConfig {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else if (isPlainObject(value) && isPlainObject(current[key])) {
      next[key] = { ...current[key], ...value };
    } else {
      next[key] = value;
    }
  }
  return { ...next, version: SHARED_CONFIG_VERSION };
}

/** @returns the file text: indented JSON with a trailing newline */
export function serializeSharedConfig(config: SharedConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}
