/**
 * Persist and query the per-provider sync manifest — the three-way merge base
 * mapping relative paths to their last-synced state.
 */
import type { LocalFileSystem } from "../../ports/index.js";
import type {
  ManifestData,
  ManifestEntry,
} from "./syncTypes.js";
import type { RemoteNamespace } from "../provider/remoteProvider.js";

// Returns a fresh empty ManifestData for a given providerId.
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

  /**
   * Loads the manifest from disk, or starts empty when absent or corrupt.
   * @usedBy syncController
   * @returns SyncManifest
   */
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
        const text = new TextDecoder("utf-8").decode(raw);
        const parsed = JSON.parse(text) as ManifestData;
        if (parsed?.namespaces?.library && parsed.namespaces.appdata) {
          data = { providerId, namespaces: parsed.namespaces };
          if (parsed.roots && typeof parsed.roots === "object") { data.roots = { ...parsed.roots }; }
        }
      } catch {
        // Corrupt manifest: fall back to empty, sync rebuilds it.
      }
    }
    return new SyncManifest(fs, filePath, data);
  }

  /**
   * Returns the entry for a path, or undefined.
   * @usedBy syncDiff, syncApply
   * @returns ManifestEntry | undefined
   */
  get(ns: RemoteNamespace, path: string): ManifestEntry | undefined {
    return this.data.namespaces[ns][path];
  }

  /**
   * Returns all relative paths recorded for a namespace.
   * @usedBy syncDiff
   * @returns string[]
   */
  paths(ns: RemoteNamespace): string[] {
    return Object.keys(this.data.namespaces[ns]);
  }

  /**
   * Inserts or replaces the entry for a path.
   * @usedBy syncApply
   * @returns void
   */
  set(ns: RemoteNamespace, path: string, entry: ManifestEntry): void {
    this.data.namespaces[ns][path] = entry;
  }

  /**
   * Removes the entry for a path, if present.
   * @usedBy syncApply
   * @returns void
   */
  delete(ns: RemoteNamespace, path: string): void {
    delete this.data.namespaces[ns][path];
  }

  /**
   * The remote root folder id the namespace was last synced against, when recorded.
   * @usedBy syncEngine
   * @returns the id, or undefined (manifests written before roots were recorded)
   */
  rootId(ns: RemoteNamespace): string | undefined {
    return this.data.roots?.[ns];
  }

  /**
   * Records the remote root folder id of a namespace.
   * @usedBy syncEngine
   * @returns void
   */
  setRootId(ns: RemoteNamespace, id: string): void {
    this.data.roots = { ...(this.data.roots ?? {}), [ns]: id };
  }

  /**
   * Forgets every entry of a namespace, so the next diff treats both sides as new (nothing is deleted).
   * @usedBy syncEngine
   * @returns void
   */
  clearNamespace(ns: RemoteNamespace): void {
    this.data.namespaces[ns] = {};
  }

  /**
   * Persists the manifest to disk.
   * @usedBy syncEngine
   * @returns void
   */
  async save(): Promise<void> {
    const json = JSON.stringify(this.data, null, 2);
    await this.fs.writeFile(this.filePath, new TextEncoder().encode(json));
  }

  /**
   * Returns a deep-copy snapshot of the underlying data (for tests/inspection).
   * @usedBy tests
   * @returns ManifestData
   */
  snapshot(): ManifestData {
    return JSON.parse(JSON.stringify(this.data)) as ManifestData;
  }
}
