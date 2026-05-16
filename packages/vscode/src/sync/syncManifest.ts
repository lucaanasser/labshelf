/**
 * Module: Sync Manifest
 * Responsibility: Persist and query the per-provider sync manifest - the
 *   three-way merge base mapping relative paths to their last-synced state
 * Dependencies: syncTypes, LocalFileSystem (injected)
 */
import type {
  LocalFileSystem,
  ManifestData,
  ManifestEntry,
} from "./syncTypes.js";
import type { RemoteNamespace } from "./remoteProvider.js";

function emptyData(providerId: string): ManifestData {
  return { providerId, namespaces: { library: {}, appdata: {} } };
}

/**
 * Reads and writes the manifest JSON via an injected LocalFileSystem.
 * The manifest is local-only state (never synced).
 */
export class SyncManifest {
  private data: ManifestData;

  private constructor(
    private readonly fs: LocalFileSystem,
    private readonly filePath: string,
    data: ManifestData,
  ) {
    this.data = data;
  }

  /** Loads the manifest from disk, or starts empty when absent/corrupt. */
  static async load(
    fs: LocalFileSystem,
    filePath: string,
    providerId: string,
  ): Promise<SyncManifest> {
    let data = emptyData(providerId);
    const stat = await fs.stat(filePath);
    if (stat?.isFile) {
      try {
        const raw = await fs.readFile(filePath);
        const parsed = JSON.parse(
          Buffer.from(raw).toString("utf8"),
        ) as ManifestData;
        if (parsed?.namespaces?.library && parsed.namespaces.appdata) {
          data = { providerId, namespaces: parsed.namespaces };
        }
      } catch {
        // Corrupt manifest: fall back to empty, sync rebuilds it.
      }
    }
    return new SyncManifest(fs, filePath, data);
  }

  /** Returns the entry for a path, or undefined. */
  get(ns: RemoteNamespace, path: string): ManifestEntry | undefined {
    return this.data.namespaces[ns][path];
  }

  /** Returns all relative paths recorded for a namespace. */
  paths(ns: RemoteNamespace): string[] {
    return Object.keys(this.data.namespaces[ns]);
  }

  /** Inserts or replaces the entry for a path. */
  set(ns: RemoteNamespace, path: string, entry: ManifestEntry): void {
    this.data.namespaces[ns][path] = entry;
  }

  /** Removes the entry for a path, if present. */
  delete(ns: RemoteNamespace, path: string): void {
    delete this.data.namespaces[ns][path];
  }

  /** Persists the manifest to disk. */
  async save(): Promise<void> {
    const json = JSON.stringify(this.data, null, 2);
    await this.fs.writeFile(this.filePath, Buffer.from(json, "utf8"));
  }

  /** Snapshot of the underlying data (for tests/inspection). */
  snapshot(): ManifestData {
    return JSON.parse(JSON.stringify(this.data)) as ManifestData;
  }
}
