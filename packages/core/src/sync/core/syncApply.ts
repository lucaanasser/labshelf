/**
 * Execute classified diff operations against RemoteProvider and LocalFileSystem,
 * including keep-both conflict resolution.
 *
 * @depends syncTypes, sync/provider/remoteProvider, sync/provider/remotePathResolver,
 *          sync/util/conflictName, syncManifest, sync/util/contentHash
 * @dependents syncEngine
 */
import type { RemoteProvider, RemoteNamespace } from "../provider/remoteProvider.js";
import type {
  LocalFileSystem,
  NamespaceResult,
  SyncOperation,
} from "./syncTypes.js";
import type { SyncManifest } from "./syncManifest.js";
import { RemotePathResolver, splitPath } from "../provider/remotePathResolver.js";
import { conflictPath } from "../util/conflictName.js";
import { sha256Hex } from "../util/contentHash.js";

/** Context the apply step needs beyond the operation list. */
export interface ApplyContext {
  namespace: RemoteNamespace;
  provider: RemoteProvider;
  fs: LocalFileSystem;
  manifest: SyncManifest;
  resolver: RemotePathResolver;
  /** Absolute root directory of the namespace on the local disk. */
  localRoot: string;
  /** Date used for conflict rename suffixes. */
  now: Date;
}

// Joins a local root directory with a relative path.
function joinLocal(root: string, path: string): string {
  return `${root}/${path}`;
}

// Uploads a local file to the remote and records the new manifest entry.
async function pushLocalToRemote(
  ctx: ApplyContext,
  op: SyncOperation,
): Promise<void> {
  const local = op.local!;
  const bytes = await ctx.fs.readFile(joinLocal(ctx.localRoot, op.path));
  const parentId = await ctx.resolver.parentOf(op.path);
  const remoteFile = await ctx.provider.upload(
    parentId,
    splitPath(op.path).name,
    bytes,
    op.remote?.remoteId,
  );
  ctx.manifest.set(ctx.namespace, op.path, {
    remoteId: remoteFile.id,
    contentHash: local.contentHash ?? (await sha256Hex(bytes)),
    modifiedTime: remoteFile.modifiedTime,
  });
}

// Downloads a remote file to the local filesystem and records the new manifest entry.
async function pullRemoteToLocal(
  ctx: ApplyContext,
  op: SyncOperation,
): Promise<void> {
  const remote = op.remote!;
  const bytes = await ctx.provider.download(remote.remoteId!);
  const target = joinLocal(ctx.localRoot, op.path);
  await ctx.fs.ensureDir(splitPath(target).dir);
  await ctx.fs.writeFile(target, bytes);
  ctx.manifest.set(ctx.namespace, op.path, {
    remoteId: remote.remoteId!,
    contentHash: await sha256Hex(bytes),
    modifiedTime: remote.modifiedTime,
  });
}

// Resolves a conflict by renaming the remote copy and uploading the local version (keep-both strategy).
async function resolveConflict(
  ctx: ApplyContext,
  op: SyncOperation,
  result: NamespaceResult,
): Promise<void> {
  const newPath = conflictPath(op.path, ctx.now);
  if (op.remote?.remoteId) {
    const parentId = await ctx.resolver.parentOf(newPath);
    const renamed = await ctx.provider.move(
      op.remote.remoteId,
      parentId,
      splitPath(newPath).name,
    );
    const bytes = await ctx.provider.download(renamed.id);
    const target = joinLocal(ctx.localRoot, newPath);
    await ctx.fs.ensureDir(splitPath(target).dir);
    await ctx.fs.writeFile(target, bytes);
    ctx.manifest.set(ctx.namespace, newPath, {
      remoteId: renamed.id,
      contentHash: await sha256Hex(bytes),
      modifiedTime: renamed.modifiedTime,
    });
    result.downloaded += 1;
  }
  ctx.manifest.delete(ctx.namespace, op.path);
  if (op.local) {
    const localOnly: SyncOperation = { path: op.path, class: op.class, local: op.local };
    await pushLocalToRemote(ctx, localOnly);
    result.uploaded += 1;
  }
  result.conflicts.push(op.path);
}

// Applies one classified operation, mutating the result counters.
async function applyOne(
  ctx: ApplyContext,
  op: SyncOperation,
  result: NamespaceResult,
): Promise<void> {
  switch (op.class) {
    case "unchanged":
      return;
    case "local-new":
    case "local-modified":
      await pushLocalToRemote(ctx, op);
      result.uploaded += 1;
      return;
    case "remote-new":
    case "remote-modified":
      await pullRemoteToLocal(ctx, op);
      result.downloaded += 1;
      return;
    case "local-deleted":
      if (op.remote?.remoteId) {
        await ctx.provider.remove(op.remote.remoteId);
      }
      ctx.manifest.delete(ctx.namespace, op.path);
      result.deletedRemote += 1;
      return;
    case "remote-deleted":
      await ctx.fs.deleteFile(joinLocal(ctx.localRoot, op.path));
      ctx.manifest.delete(ctx.namespace, op.path);
      result.deletedLocal += 1;
      return;
    case "conflict":
      await resolveConflict(ctx, op, result);
      return;
  }
}

/**
 * Applies every operation for a namespace and returns its aggregated result.
 * @usedBy syncEngine
 * @returns NamespaceResult
 */
export async function applyOperations(
  ctx: ApplyContext,
  ops: SyncOperation[],
): Promise<NamespaceResult> {
  const result: NamespaceResult = {
    namespace: ctx.namespace,
    uploaded: 0,
    downloaded: 0,
    deletedLocal: 0,
    deletedRemote: 0,
    conflicts: [],
  };
  for (const op of ops) {
    await applyOne(ctx, op, result);
  }
  return result;
}
