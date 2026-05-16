/**
 * Module: Sync Engine
 * Responsibility: Provider-agnostic orchestration of a sync run - scan local
 *   and remote trees, diff against the manifest, apply operations, persist
 * Dependencies: remoteProvider, syncTypes, syncManifest, syncDiff, syncApply,
 *   treeScan, remotePathResolver
 */
import type { RemoteProvider, RemoteNamespace } from "./remoteProvider.js";
import type {
  LocalFileSystem,
  NamespaceResult,
  SyncResult,
} from "./syncTypes.js";
import type { SyncManifest } from "./syncManifest.js";
import { diffNamespace } from "./syncDiff.js";
import { applyOperations } from "./syncApply.js";
import { scanLocalTree, scanRemoteTree } from "./treeScan.js";
import { RemotePathResolver } from "./remotePathResolver.js";

/** Maps each namespace to its absolute local root directory. */
export type NamespaceRoots = Record<RemoteNamespace, string>;

/** Name translation maps for one namespace (e.g. paperId ↔ paper title). */
export interface FolderNameMaps {
  /** Local folder name → remote display name (used when creating folders). */
  localToRemote: Map<string, string>;
  /** Remote display name → local folder name (used when scanning remote). */
  remoteToLocal: Map<string, string>;
}

/** Dependencies injected into the engine (no vscode, no ambient globals). */
export interface SyncEngineDeps {
  provider: RemoteProvider;
  fs: LocalFileSystem;
  manifest: SyncManifest;
  roots: NamespaceRoots;
  /** Clock override for deterministic conflict naming/results. */
  clock?: () => Date;
  /** Optional name translation for the 'library' namespace. */
  libraryFolderNames?: FolderNameMaps;
}

const NAMESPACES: RemoteNamespace[] = ["library", "appdata"];

/**
 * Runs a full bidirectional sync. The engine never talks to a concrete
 * backend - it only uses the injected RemoteProvider and LocalFileSystem.
 */
export class SyncEngine {
  constructor(private readonly deps: SyncEngineDeps) {}

  private now(): Date {
    return this.deps.clock ? this.deps.clock() : new Date();
  }

  /** Syncs a single namespace and returns its per-namespace result. */
  private async syncNamespace(
    ns: RemoteNamespace,
  ): Promise<NamespaceResult> {
    const { provider, fs, manifest, roots, libraryFolderNames } = this.deps;
    const root = await provider.resolveRoot(ns);

    const names = ns === "library" ? libraryFolderNames : undefined;
    const resolver = new RemotePathResolver(provider, root.id, [], names?.localToRemote);
    const remoteTree = await scanRemoteTree(provider, root.id, resolver, names?.remoteToLocal);
    const localTree = await scanLocalTree(fs, roots[ns]);

    const ops = diffNamespace(ns, localTree, remoteTree, manifest);
    return applyOperations(
      {
        namespace: ns,
        provider,
        fs,
        manifest,
        resolver,
        localRoot: roots[ns],
        now: this.now(),
      },
      ops,
    );
  }

  /** Runs the full sync across both namespaces and persists the manifest. */
  async run(): Promise<SyncResult> {
    if (!this.deps.provider.isConnected()) {
      throw new Error("Sync provider is not connected");
    }
    const startedAt = this.now().toISOString();
    const namespaces: NamespaceResult[] = [];
    for (const ns of NAMESPACES) {
      namespaces.push(await this.syncNamespace(ns));
    }
    await this.deps.manifest.save();
    return {
      providerId: this.deps.provider.id,
      namespaces,
      startedAt,
      finishedAt: this.now().toISOString(),
    };
  }
}
