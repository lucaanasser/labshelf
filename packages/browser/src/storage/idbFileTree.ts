/** Tree operations over the "files" store, where a folder is the set of rows whose key starts with `<folder>/`. */
import { getDb } from "./idb/db";
import type { FileRow } from "./idb/schema";

/** @returns the key range covering everything below `dir` */
export function belowDir(dir: string): IDBKeyRange {
  const prefix = `${dir}/`;
  return IDBKeyRange.bound(prefix, `${prefix}￿`, false, true);
}

/**
 * Re-keys the row `from`, or every row below it, to `to` in one transaction, keeping bytes, mtime and hash so a sync
 * sees a plain rename.
 */
export async function renameTree(from: string, to: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("files", "readwrite");
  const rows = await rowsAt(tx.store, from);
  if (rows.length === 0) { throw new Error(`File not found: ${from}`); }
  if ((await tx.store.get(to)) !== undefined || (await tx.store.getKey(belowDir(to))) !== undefined) {
    throw new Error(`Already exists: ${to}`);
  }
  for (const row of rows) {
    await tx.store.delete(row.path);
    await tx.store.put({ ...row, path: `${to}${row.path.slice(from.length)}` });
  }
  await tx.done;
}

/** Deletes the row `target` and every row below it in one transaction. */
export async function deleteTree(target: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("files", "readwrite");
  await tx.store.delete(target);
  await tx.store.delete(belowDir(target));
  await tx.done;
}

async function rowsAt(store: { get(key: string): Promise<FileRow | undefined>; getAll(range: IDBKeyRange): Promise<FileRow[]> }, path: string): Promise<FileRow[]> {
  const own = await store.get(path);
  return [...(own ? [own] : []), ...(await store.getAll(belowDir(path)))];
}
