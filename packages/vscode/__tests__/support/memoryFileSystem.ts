/** An in-memory IFileSystem keyed by absolute path, so store tests never touch the disk. */
import type { IFileSystem } from '@labshelf/core';

export function makeMemoryFileSystem(files: Map<string, string> = new Map()): IFileSystem {
  return {
    ensureDir: jest.fn(async () => {}),
    writeText: jest.fn(async (target: string, content: string) => { files.set(target, content); }),
    readText: jest.fn(async (target: string) => {
      const content = files.get(target);
      if (content === undefined) { throw new Error('ENOENT ' + target); }
      return content;
    }),
    exists: jest.fn(async (target: string) => files.has(target)),
  };
}
