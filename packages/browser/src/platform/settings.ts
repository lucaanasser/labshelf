/**
 * Typed wrapper around bx.storage.local for user-facing preferences.
 * The options page reads/writes here, and resolvers consult these values to
 * decide whether to attempt Sci-Hub, which mirror to use, etc.
 * @depends platform/browserApi
 * @dependents capture/resolvers, options/index, background scheduler
 */
import { bx } from "./browserApi";

/** Persisted user preferences. */
export interface LabShelfSettings {
  /** When true, the capture chain consults the Sci-Hub mirror as a last resort. */
  enableSciHub: boolean;
  /** Sci-Hub mirror base URL, e.g. "https://sci-hub.se". */
  sciHubMirror: string;
  /** Contact email passed to the Unpaywall API and CrossRef User-Agent. */
  contactEmail: string;
  /** Auto-sync interval in minutes; 0 disables interval sync. */
  autoSyncMinutes: number;
}

const STORAGE_KEY = "labshelf.settings";

const DEFAULTS: LabShelfSettings = {
  enableSciHub: false,
  sciHubMirror: "https://sci-hub.se",
  contactEmail: "contact@labshelf.dev",
  autoSyncMinutes: 15,
};

/**
 * Reads the merged settings object (defaults overlaid with persisted values).
 * @usedBy resolvers/scihubResolver, resolvers/unpaywallResolver, options/index
 * @returns LabShelfSettings
 */
export async function getSettings(): Promise<LabShelfSettings> {
  const raw = (await bx.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
  const stored = (raw[STORAGE_KEY] ?? {}) as Partial<LabShelfSettings>;
  return { ...DEFAULTS, ...stored };
}

/**
 * Persists a partial settings patch, merging with whatever is already stored.
 * @usedBy options/index
 */
export async function updateSettings(patch: Partial<LabShelfSettings>): Promise<void> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await bx.storage.local.set({ [STORAGE_KEY]: next });
}
