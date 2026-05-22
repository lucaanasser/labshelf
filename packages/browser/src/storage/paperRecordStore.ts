/**
 * Persistent cache of PaperRecord objects, derived from metadata.yaml files
 * stored in IndexedDB. Provides fast folder-scoped and title-search queries
 * without re-parsing YAML on every read.
 * @depends idb/db, @labshelf/core PaperRecord, yaml
 * @dependents library-page views (Phase 6), capture flow (Phase 5), storage/index
 */
import type { PaperRecord } from "@labshelf/core";
import YAML from "yaml";
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

/** Returns all cached PaperRecords, unordered. */
export async function listAllRecords(): Promise<PaperRecord[]> {
  const db = await getDb();
  const rows = await db.getAll("metadata");
  return rows.map((r) => r.record);
}

/** Returns PaperRecords whose folderPath starts with the given prefix. */
export async function listByFolder(prefix: string): Promise<PaperRecord[]> {
  const db = await getDb();
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`, false, true);
  const rows = await db.getAllFromIndex("metadata", "byFolder", range);
  return rows.map((r) => r.record);
}

/** Case-insensitive substring search over title and authors. */
export async function searchRecords(query: string): Promise<PaperRecord[]> {
  const all = await listAllRecords();
  const q = query.toLowerCase();
  return all.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      r.authors?.some((a) => a.toLowerCase().includes(q)),
  );
}

/**
 * Parses a metadata.yaml string and upserts the resulting PaperRecord.
 * Called by the sync apply step after writing metadata.yaml to the files store.
 */
export async function upsertFromYaml(yamlText: string, folderPath: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const parsed = YAML.parse(yamlText) as PaperRecord;
  if (parsed?.id && parsed.title) {
    await upsertRecord(parsed, folderPath);
  }
}

/**
 * Rebuilds the entire metadata cache from the files store. Should be called
 * once after an initial sync or a full re-import.
 */
export async function rebuildFromFiles(
  readFile: (path: string) => Promise<Uint8Array>,
  listByPrefix: (prefix: string) => Promise<string[]>,
): Promise<void> {
  const db = await getDb();
  await db.clear("metadata");

  const paperFolders = await listByPrefix("papers");
  const decoder = new TextDecoder();

  await Promise.all(
    paperFolders.map(async (folder) => {
      const metaPath = `papers/${folder}/metadata.yaml`;
      try {
        const bytes = await readFile(metaPath);
        await upsertFromYaml(decoder.decode(bytes), `papers/${folder}`);
      } catch {
        // File may not exist yet — skip silently
      }
    }),
  );
}
