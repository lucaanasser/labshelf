/**
 * Persistent cache of PaperRecord objects, derived from the metadata.yaml files
 * stored in IndexedDB, so reads never re-parse YAML.
 */
import { METADATA_FILE, PAPERS_DIR, paperRecordFromMetadata, parsePaperMetadata, type PaperRecord } from "@labshelf/core";
import { pdfDirsFromKeys } from "./folderTreeStore";
import { getDb } from "./idb/db";

/** Upserts a PaperRecord into the metadata cache. */
export async function upsertRecord(record: PaperRecord, folderPath: string): Promise<void> {
  const db = await getDb();
  await db.put("metadata", { paperId: record.id, record, folderPath });
}

/** Removes a PaperRecord from the cache by its id. */
export async function deleteRecord(paperId: string): Promise<void> {
  const db = await getDb();
  await db.delete("metadata", paperId);
}

/** Returns one cached PaperRecord by id, or undefined when the library does not hold it. */
export async function getRecord(paperId: string): Promise<PaperRecord | undefined> {
  const db = await getDb();
  return (await db.get("metadata", paperId))?.record;
}

/** Returns all cached PaperRecords, unordered. */
export async function listAllRecords(): Promise<PaperRecord[]> {
  const db = await getDb();
  const rows = await db.getAll("metadata");
  return rows.map((r) => r.record);
}

/**
 * Rebuilds the entire metadata cache from the files store: every
 * metadata.yaml under papers/, at any depth (papers live inside collections).
 * Called after each sync cycle, which may have added, moved or removed papers.
 * The paper id is the folder name (== cite key) and the path is where the folder
 * sits in this library, not the `path:` key the last writer left in the file.
 */
export async function rebuildFromFiles(): Promise<void> {
  const db = await getDb();
  const keys = (await db.getAllKeys("files", IDBKeyRange.bound(`${PAPERS_DIR}/`, `${PAPERS_DIR}/\uffff`, false, true))) as string[];
  const pdfs = pdfDirsFromKeys(keys);
  const decoder = new TextDecoder();
  const records: PaperRecord[] = [];
  for (const key of keys) {
    if (!key.endsWith(`/${METADATA_FILE}`)) continue;
    const folderPath = key.slice(0, -`/${METADATA_FILE}`.length);
    const id = folderPath.slice(folderPath.lastIndexOf("/") + 1);
    const row = id ? await db.get("files", key) : undefined;
    const meta = row ? parsePaperMetadata(decoder.decode(row.bytes)) : undefined;
    if (meta) records.push(paperRecordFromMetadata(meta, { id, path: folderPath, hasPdf: pdfs.has(folderPath) }));
  }
  // One transaction so readers never observe the cache half-cleared.
  const tx = db.transaction("metadata", "readwrite");
  await tx.store.clear();
  for (const record of records) await tx.store.put({ paperId: record.id, record, folderPath: record.path });
  await tx.done;
}
