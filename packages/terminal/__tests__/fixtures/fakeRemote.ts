/**
 * Test fake: in-memory RemoteProvider with the two namespace roots the sync engine uses. Adapted from the VS Code
 * package's sync fakes (packages/vscode/__tests__/sync/fakes.ts), copied rather than imported across packages.
 */
import type { RemoteFile, RemoteNamespace, RemoteProvider } from "@labshelf/core";

import type { TokenData, TokenStore } from "../../src/sync/tokenStore";

/** In-memory TokenStore: the real Keychain / secret-tool / credentials file are never touched by tests. */
export class MemoryTokenStore implements TokenStore {
  readonly kind = "file" as const;
  saves: TokenData[] = [];
  cleared = 0;
  loads = 0;

  constructor(public tokens: TokenData | null = null) {}

  async load(): Promise<TokenData | null> {
    this.loads++;
    return this.tokens ? { ...this.tokens } : null;
  }

  async save(tokens: TokenData): Promise<void> {
    this.tokens = { ...tokens };
    this.saves.push({ ...tokens });
  }

  async clear(): Promise<void> {
    this.tokens = null;
    this.cleared++;
  }
}

interface RemoteNode {
  file: RemoteFile;
  parentId: string;
  data?: Uint8Array;
}

export class FakeRemoteProvider implements RemoteProvider {
  readonly displayName = "Fake Drive";
  private connected = true;
  private seq = 0;
  private clockMs = 10_000;
  private readonly nodes = new Map<string, RemoteNode>();
  private readonly roots: Record<RemoteNamespace, string>;
  private failure: Error | undefined;

  /** Called at the start of every resolveRoot (i.e. while a sync run is in progress); lets tests peek at local state. */
  onResolveRoot: (() => void | Promise<void>) | undefined;

  /** Calls to upload / remove, so tests can assert nothing was re-sent. */
  readonly uploads: string[] = [];
  readonly removals: string[] = [];

  constructor(readonly id = "google-drive") {
    this.roots = { library: this.mkRoot("library"), appdata: this.mkRoot("appdata") };
  }

  private mkRoot(name: string): string {
    const id = `root-${name}`;
    this.nodes.set(id, { file: { id, name, isFolder: true, modifiedTime: this.stamp() }, parentId: "" });
    return id;
  }

  private stamp(): string {
    this.clockMs += 1_000;
    return new Date(this.clockMs).toISOString();
  }

  /** Makes the next resolveRoot call (the first thing a sync run does) reject with this error. */
  failWith(error: Error | undefined): void {
    this.failure = error;
  }

  setConnected(value: boolean): void {
    this.connected = value;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async resolveRoot(ns: RemoteNamespace): Promise<RemoteFile> {
    await this.onResolveRoot?.();
    if (this.failure) { throw this.failure; }
    return this.nodes.get(this.roots[ns])!.file;
  }

  async list(folderId: string): Promise<RemoteFile[]> {
    return [...this.nodes.values()].filter((n) => n.parentId === folderId).map((n) => ({ ...n.file }));
  }

  async createFolder(parentId: string, name: string): Promise<RemoteFile> {
    const id = `f-${++this.seq}`;
    const file: RemoteFile = { id, name, isFolder: true, modifiedTime: this.stamp() };
    this.nodes.set(id, { file, parentId });
    return { ...file };
  }

  async upload(parentId: string, name: string, content: Uint8Array, existingId?: string): Promise<RemoteFile> {
    const id = existingId ?? `file-${++this.seq}`;
    const file: RemoteFile = { id, name, isFolder: false, modifiedTime: this.stamp(), size: content.length };
    this.nodes.set(id, { file, parentId, data: content });
    this.uploads.push(`${this.pathOf(id)}`);
    return { ...file };
  }

  async download(fileId: string): Promise<Uint8Array> {
    const node = this.nodes.get(fileId);
    if (!node?.data) { throw new Error(`remote ENOENT: ${fileId}`); }
    return node.data;
  }

  async remove(fileId: string): Promise<void> {
    this.removals.push(this.pathOf(fileId));
    if (!this.nodes.delete(fileId)) { throw new Error(`remote ENOENT: ${fileId}`); }
  }

  async move(fileId: string, newParentId: string, newName?: string): Promise<RemoteFile> {
    const node = this.nodes.get(fileId);
    if (!node) { throw new Error(`remote ENOENT: ${fileId}`); }
    node.parentId = newParentId;
    if (newName) { node.file.name = newName; }
    node.file.modifiedTime = this.stamp();
    return { ...node.file };
  }

  // "Folder/Sub/file" path of a node as Drive would show it (root name excluded).
  private pathOf(id: string): string {
    const parts: string[] = [];
    let node = this.nodes.get(id);
    while (node && node.parentId !== "") {
      parts.unshift(node.file.name);
      node = this.nodes.get(node.parentId);
    }
    return parts.join("/");
  }

  /** Every file in a namespace as "Folder/Sub/file" (Drive display names), sorted. */
  filePaths(ns: RemoteNamespace): string[] {
    const out: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.file.isFolder || id === this.roots[ns]) { continue; }
      if (this.rootOf(id) === this.roots[ns]) { out.push(this.pathOf(id)); }
    }
    return out.sort();
  }

  /** Every folder in a namespace as "Folder/Sub" (Drive display names), sorted. */
  folderPaths(ns: RemoteNamespace): string[] {
    const out: string[] = [];
    for (const [id, node] of this.nodes) {
      if (!node.file.isFolder || id === this.roots[ns]) { continue; }
      if (this.rootOf(id) === this.roots[ns]) { out.push(this.pathOf(id)); }
    }
    return out.sort();
  }

  /** Text of a file by its Drive display path, or undefined. */
  readText(ns: RemoteNamespace, displayPath: string): string | undefined {
    for (const [id, node] of this.nodes) {
      if (!node.file.isFolder && this.rootOf(id) === this.roots[ns] && this.pathOf(id) === displayPath) {
        return Buffer.from(node.data ?? new Uint8Array()).toString("utf8");
      }
    }
    return undefined;
  }

  /** Bytes of a file by its Drive display path, or undefined. */
  readBytes(ns: RemoteNamespace, displayPath: string): Uint8Array | undefined {
    for (const [id, node] of this.nodes) {
      if (!node.file.isFolder && this.rootOf(id) === this.roots[ns] && this.pathOf(id) === displayPath) {
        return node.data;
      }
    }
    return undefined;
  }

  private rootOf(id: string): string {
    let node = this.nodes.get(id);
    let last = id;
    while (node && node.parentId !== "") {
      last = node.parentId;
      node = this.nodes.get(node.parentId);
    }
    return last;
  }

  /** Test helper: seed a file directly under a namespace root. */
  seedFile(ns: RemoteNamespace, name: string, content: string): RemoteFile {
    const id = `seed-${++this.seq}`;
    const file: RemoteFile = { id, name, isFolder: false, modifiedTime: this.stamp(), size: content.length };
    this.nodes.set(id, { file, parentId: this.roots[ns], data: Buffer.from(content, "utf8") });
    return file;
  }
}
