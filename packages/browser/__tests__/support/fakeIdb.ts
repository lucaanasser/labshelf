/** A Map-backed stand-in for the "files" IndexedDB store, for tests of code that goes through getDb(). */
import type { FileRow } from "../../src/storage/idb/schema";

export const fakeFiles = new Map<string, FileRow>();

interface FakeRange { lo: string; hi: string }

// Production code builds ranges with the browser's IDBKeyRange, which Node lacks.
(globalThis as Record<string, unknown>)["IDBKeyRange"] = {
  bound: (lo: string, hi: string): FakeRange => ({ lo, hi }),
};

function keysIn(range: FakeRange | undefined): string[] {
  return [...fakeFiles.keys()].filter((key) => !range || (key >= range.lo && key < range.hi)).sort();
}

const store = {
  get: async (key: string) => fakeFiles.get(key),
  getKey: async (range: FakeRange) => keysIn(range)[0],
  getAllKeys: async (range?: FakeRange) => keysIn(range),
  getAll: async (range?: FakeRange) => keysIn(range).map((key) => fakeFiles.get(key)!),
  put: async (row: FileRow) => { fakeFiles.set(row.path, row); },
  delete: async (target: string | FakeRange) => {
    for (const key of typeof target === "string" ? [target] : keysIn(target)) { fakeFiles.delete(key); }
  },
};

export const fakeDb = {
  get: (_name: string, key: string) => store.get(key),
  getKey: (_name: string, range: FakeRange) => store.getKey(range),
  getAllKeys: (_name: string, range?: FakeRange) => store.getAllKeys(range),
  put: (_name: string, row: FileRow) => store.put(row),
  delete: (_name: string, key: string) => store.delete(key),
  transaction: () => ({ store, done: Promise.resolve() }),
};

export function putFile(path: string, content: string | Uint8Array): void {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  fakeFiles.set(path, { path, bytes, mtime: 0, hash: "" });
}

export function textAt(path: string): string | undefined {
  const row = fakeFiles.get(path);
  return row && new TextDecoder().decode(row.bytes);
}
