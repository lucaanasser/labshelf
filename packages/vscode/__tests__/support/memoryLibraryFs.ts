/** An in-memory LibraryFileSystem keyed by absolute "/" path, so the paper glue runs the real core mutations without a disk. */
import type { LibraryFileSystem, LocalStat } from '@labshelf/core';

const parentOf = (target: string): string => target.slice(0, Math.max(target.lastIndexOf('/'), 1));
const under = (target: string, dir: string): boolean => target === dir || target.startsWith(`${dir}/`);

export class MemoryLibraryFs implements LibraryFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(['/']);
  /** Paths whose trash fails. */
  readonly trashFails = new Set<string>();
  /** Set to make every writeFile fail. */
  failWrites: Error | undefined;

  async ensureDir(dir: string): Promise<void> {
    for (let current = dir; current !== '/'; current = parentOf(current)) { this.dirs.add(current); }
  }
  async mkdir(dir: string): Promise<void> { await this.ensureDir(dir); }
  async writeText(file: string, content: string): Promise<void> { await this.writeFile(file, new TextEncoder().encode(content)); }
  async writeFile(file: string, content: Uint8Array): Promise<void> {
    if (this.failWrites) { throw this.failWrites; }
    await this.ensureDir(parentOf(file));
    this.files.set(file, content.slice());
  }
  async readText(file: string): Promise<string> { return new TextDecoder().decode(await this.readFile(file)); }
  async readFile(file: string): Promise<Uint8Array> {
    const content = this.files.get(file);
    if (!content) { throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' }); }
    return content.slice();
  }
  async exists(target: string): Promise<boolean> { return this.files.has(target) || this.dirs.has(target); }
  async deleteFile(file: string): Promise<void> { this.files.delete(file); }
  async stat(target: string): Promise<LocalStat | undefined> {
    if (this.files.has(target)) { return { isFile: true, isDirectory: false, mtimeMs: 0, size: this.files.get(target)!.length }; }
    return this.dirs.has(target) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
  }
  async listDir(dir: string): Promise<string[]> {
    const names = new Set<string>();
    for (const target of [...this.files.keys(), ...this.dirs]) {
      if (target !== dir && parentOf(target) === dir) { names.add(target.slice(dir.length + 1)); }
    }
    return [...names];
  }
  async rename(from: string, to: string): Promise<void> {
    if (await this.exists(to)) { throw new Error(`EEXIST: ${to}`); }
    for (const [file, content] of [...this.files]) {
      if (under(file, from)) { this.files.delete(file); this.files.set(to + file.slice(from.length), content); }
    }
    for (const dir of [...this.dirs]) {
      if (under(dir, from)) { this.dirs.delete(dir); this.dirs.add(to + dir.slice(from.length)); }
    }
  }
  async trash(target: string): Promise<void> {
    if (this.trashFails.has(target)) { throw new Error(`Cannot move ${target} to the trash`); }
    for (const file of [...this.files.keys()]) { if (under(file, target)) { this.files.delete(file); } }
    for (const dir of [...this.dirs]) { if (under(dir, target)) { this.dirs.delete(dir); } }
  }
}
