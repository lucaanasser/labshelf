/**
 * Persistent cache of PaperRecord objects, derived from metadata.yaml files
 * stored in IndexedDB. Provides fast folder-scoped and title-search queries
 * without re-parsing YAML on every read.
 * @depends idb/db, @labshelf/core PaperRecord, yaml
 * @dependents library-page views (Phase 6), capture flow (Phase 5), storage/index
 */
import { isPaperStatus, type PaperRecord } from "@labshelf/core";
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
 * Maps a metadata.yaml sidecar onto a PaperRecord, the way the VS Code
 * LibraryIndexer does: the paper id is the folder name (== cite key) and the
 * path is where the folder sits in this library — the `path:` key inside the
 * file is whatever the last writer used (an absolute path on the desktop).
 * @usedBy rebuildFromFiles
 * @returns The record, or undefined when the text is not a YAML mapping.
 */
export function recordFromYaml(yamlText: string, folderPath: string): PaperRecord | undefined {
  let meta: Record<string, unknown>;
  try {
    const parsed = YAML.parse(yamlText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    meta = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const id = folderPath.slice(folderPath.lastIndexOf("/") + 1);
  if (!id) return undefined;
  const str = (key: string): string | undefined => {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v;
    return typeof v === "number" ? String(v) : undefined;
  };
  const list = (key: string): string[] => {
    const v = meta[key];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  };
  const status = meta["status"];
  const record: PaperRecord = {
    id,
    title: str("title") ?? id,
    path: folderPath,
    citeKey: str("citekey") ?? id,
    status: isPaperStatus(status) ? status : "unread",
  };
  const authors = list("authors");
  if (authors.length) record.authors = authors;
  if (typeof meta["year"] === "number") record.year = meta["year"];
  for (const key of ["summary", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language", "note"] as const) {
    const value = str(key);
    if (value) record[key] = value;
  }
  const keywords = list("keywords");
  if (keywords.length) record.keywords = keywords;
  const tags = list("tags");
  if (tags.length) record.tags = tags;
  return record;
}

/**
 * Rebuilds the entire metadata cache from the files store: every
 * metadata.yaml under papers/, at any depth (papers live inside collections).
 * Called after each sync cycle, which may have added, moved or removed papers.
 * @usedBy sync/browserSyncController
 */
export async function rebuildFromFiles(): Promise<void> {
  const db = await getDb();
  const keys = (await db.getAllKeys("files", IDBKeyRange.bound("papers/", "papers/\uffff", false, true))) as string[];
  const decoder = new TextDecoder();
  const records: PaperRecord[] = [];
  for (const key of keys) {
    if (!key.endsWith("/metadata.yaml")) continue;
    const row = await db.get("files", key);
    const folderPath = key.slice(0, -"/metadata.yaml".length);
    const record = row ? recordFromYaml(decoder.decode(row.bytes), folderPath) : undefined;
    if (record) records.push(record);
  }
  // One transaction so readers never observe the cache half-cleared.
  const tx = db.transaction("metadata", "readwrite");
  await tx.store.clear();
  for (const record of records) await tx.store.put({ paperId: record.id, record, folderPath: record.path });
  await tx.done;
}
