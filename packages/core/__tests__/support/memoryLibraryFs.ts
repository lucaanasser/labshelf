/** An in-memory LibraryFileSystem with "/" paths, for tests of the library mutations. */
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";

function parentOf(target: string): string {
  const slash = target.lastIndexOf("/");
  return slash <= 0 ? "/" : target.slice(0, slash);
}

function under(target: string, dir: string): boolean {
  return target === dir || target.startsWith(dir === "/" ? "/" : `${dir}/`);
}

function errno(code: string, target: string): Error {
  return Object.assign(new Error(`${code}: ${target}`), { code });
}

export class MemoryLibraryFs implements LibraryFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(["/"]);
  /** Paths that stat as neither file nor folder. */
  readonly symlinks = new Set<string>();
  /** Folders whose listing fails. */
  readonly unreadable = new Set<string>();
  /** Paths whose trash fails. */
  readonly trashFails = new Set<string>();
  readonly trashed: string[] = [];
  readonly renames: Array<[string, string]> = [];
  writes = 0;

  async ensureDir(dir: string): Promise<void> {
    for (let current = dir; current !== "/"; current = parentOf(current)) { this.dirs.add(current); }
  }

  async mkdir(dir: string): Promise<void> { await this.ensureDir(dir); }

  async writeText(file: string, content: string): Promise<void> {
    await this.writeFile(file, new TextEncoder().encode(content));
  }

  async writeFile(file: string, content: Uint8Array): Promise<void> {
    await this.ensureDir(parentOf(file));
    this.files.set(file, content.slice());
    this.writes += 1;
  }

  async readText(file: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(file));
  }

  async readFile(file: string): Promise<Uint8Array> {
    const content = this.files.get(file);
    if (!content) { throw errno("ENOENT", file); }
    return content.slice();
  }

  async exists(target: string): Promise<boolean> {
    return this.files.has(target) || this.dirs.has(target) || this.symlinks.has(target);
  }

  async deleteFile(file: string): Promise<void> { this.files.delete(file); }

  async stat(target: string): Promise<LocalStat | undefined> {
    if (this.files.has(target)) { return { isFile: true, isDirectory: false, mtimeMs: 0, size: this.files.get(target)!.length }; }
    if (this.dirs.has(target)) { return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 }; }
    if (this.symlinks.has(target)) { return { isFile: false, isDirectory: false, mtimeMs: 0, size: 0 }; }
    return undefined;
  }

  async listDir(dir: string): Promise<string[]> {
    if (this.unreadable.has(dir)) { throw errno("EACCES", dir); }
    const names = new Set<string>();
    for (const target of [...this.files.keys(), ...this.dirs, ...this.symlinks]) {
      if (target !== dir && parentOf(target) === dir) { names.add(target.slice(dir === "/" ? 1 : dir.length + 1)); }
    }
    return [...names];
  }

  async rename(from: string, to: string): Promise<void> {
    if (!(await this.exists(from))) { throw errno("ENOENT", from); }
    if (from.toLowerCase() !== to.toLowerCase() && (await this.exists(to))) { throw errno("EEXIST", to); }
    this.moveTree(from, to);
    this.renames.push([from, to]);
  }

  async trash(target: string): Promise<void> {
    if (this.trashFails.has(target)) { throw new Error(`Cannot move ${target} to the trash`); }
    this.removeTree(target);
    this.trashed.push(target);
  }

  /** @returns every file path, sorted */
  fileList(): string[] {
    return [...this.files.keys()].sort();
  }

  private moveTree(from: string, to: string): void {
    const rebase = (target: string) => to + target.slice(from.length);
    for (const [file, content] of [...this.files]) {
      if (under(file, from)) { this.files.delete(file); this.files.set(rebase(file), content); }
    }
    for (const dir of [...this.dirs]) {
      if (under(dir, from)) { this.dirs.delete(dir); this.dirs.add(rebase(dir)); }
    }
  }

  private removeTree(target: string): void {
    for (const file of [...this.files.keys()]) { if (under(file, target)) { this.files.delete(file); } }
    for (const dir of [...this.dirs]) { if (under(dir, target)) { this.dirs.delete(dir); } }
  }
}
