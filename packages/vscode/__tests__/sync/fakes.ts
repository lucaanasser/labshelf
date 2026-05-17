/**
 * Test fakes: in-memory LocalFileSystem and RemoteProvider for sync tests.
 */
import type {
  LocalFileSystem,
  LocalStat,
} from "../../src/sync/core/syncTypes.js";
import type {
  RemoteFile,
  RemoteNamespace,
  RemoteProvider,
} from "../../src/sync/provider/remoteProvider.js";

/** In-memory filesystem keyed by absolute POSIX paths. */
export class MemoryFileSystem implements LocalFileSystem {
  private readonly files = new Map<string, { data: Uint8Array; mtimeMs: number }>();
  private readonly dirs = new Set<string>([""]);

  constructor(private clock = () => 1_000) {}

  seed(path: string, content: string, mtimeMs = this.clock()): void {
    this.ensureParents(path);
    this.files.set(path, {
      data: Buffer.from(content, "utf8"),
      mtimeMs,
    });
  }

  private ensureParents(path: string): void {
    const parts = path.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] ?? "";
      acc = i === 0 ? part : `${acc}/${part}`;
      if (acc) this.dirs.add(acc);
    }
  }

  async listDir(dirPath: string): Promise<string[]> {
    const prefix = dirPath ? `${dirPath}/` : "";
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (key === dirPath || !key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.length === 0) continue;
      const head = rest.split("/")[0];
      if (head) names.add(head);
    }
    return [...names].sort();
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    const f = this.files.get(filePath);
    if (!f) throw new Error(`ENOENT: ${filePath}`);
    return f.data;
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    this.ensureParents(filePath);
    this.files.set(filePath, { data: content, mtimeMs: this.clock() });
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!this.files.delete(filePath)) {
      throw new Error(`ENOENT: ${filePath}`);
    }
  }

  async stat(targetPath: string): Promise<LocalStat | undefined> {
    const f = this.files.get(targetPath);
    if (f) {
      return {
        isFile: true,
        isDirectory: false,
        mtimeMs: f.mtimeMs,
        size: f.data.length,
      };
    }
    if (this.dirs.has(targetPath)) {
      return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 };
    }
    return undefined;
  }

  async ensureDir(dirPath: string): Promise<void> {
    const parts = dirPath.split("/");
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? "";
      acc = i === 0 ? part : `${acc}/${part}`;
      if (acc) this.dirs.add(acc);
    }
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  text(path: string): string {
    return Buffer.from(this.files.get(path)!.data).toString("utf8");
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}

interface RemoteNode {
  file: RemoteFile;
  parentId: string;
  data?: Uint8Array;
}

/** In-memory RemoteProvider with two namespace roots. */
export class FakeRemoteProvider implements RemoteProvider {
  readonly id = "fake";
  readonly displayName = "Fake Provider";
  private connected = true;
  private seq = 0;
  private clockMs = 10_000;
  private readonly nodes = new Map<string, RemoteNode>();
  private readonly roots: Record<RemoteNamespace, string>;

  constructor() {
    this.roots = {
      library: this.mkRoot("library"),
      appdata: this.mkRoot("appdata"),
    };
  }

  private mkRoot(name: string): string {
    const id = `root-${name}`;
    this.nodes.set(id, {
      file: { id, name, isFolder: true, modifiedTime: this.stamp() },
      parentId: "",
    });
    return id;
  }

  private stamp(): string {
    this.clockMs += 1_000;
    return new Date(this.clockMs).toISOString();
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
    return this.nodes.get(this.roots[ns])!.file;
  }

  async list(folderId: string): Promise<RemoteFile[]> {
    return [...this.nodes.values()]
      .filter((n) => n.parentId === folderId)
      .map((n) => ({ ...n.file }));
  }

  async createFolder(parentId: string, name: string): Promise<RemoteFile> {
    const id = `f-${++this.seq}`;
    const file: RemoteFile = {
      id,
      name,
      isFolder: true,
      modifiedTime: this.stamp(),
    };
    this.nodes.set(id, { file, parentId });
    return { ...file };
  }

  async upload(
    parentId: string,
    name: string,
    content: Uint8Array,
    existingId?: string,
  ): Promise<RemoteFile> {
    const id = existingId ?? `file-${++this.seq}`;
    const file: RemoteFile = {
      id,
      name,
      isFolder: false,
      modifiedTime: this.stamp(),
      size: content.length,
    };
    this.nodes.set(id, { file, parentId, data: content });
    return { ...file };
  }

  async download(fileId: string): Promise<Uint8Array> {
    const node = this.nodes.get(fileId);
    if (!node?.data) throw new Error(`remote ENOENT: ${fileId}`);
    return node.data;
  }

  async remove(fileId: string): Promise<void> {
    if (!this.nodes.delete(fileId)) {
      throw new Error(`remote ENOENT: ${fileId}`);
    }
  }

  async move(
    fileId: string,
    newParentId: string,
    newName?: string,
  ): Promise<RemoteFile> {
    const node = this.nodes.get(fileId);
    if (!node) throw new Error(`remote ENOENT: ${fileId}`);
    node.parentId = newParentId;
    if (newName) node.file.name = newName;
    node.file.modifiedTime = this.stamp();
    return { ...node.file };
  }

  /** Test helper: seed a file directly under a namespace root. */
  seedFile(
    ns: RemoteNamespace,
    name: string,
    content: string,
  ): RemoteFile {
    const id = `seed-${++this.seq}`;
    const file: RemoteFile = {
      id,
      name,
      isFolder: false,
      modifiedTime: this.stamp(),
      size: content.length,
    };
    this.nodes.set(id, {
      file,
      parentId: this.roots[ns],
      data: Buffer.from(content, "utf8"),
    });
    return file;
  }
}
