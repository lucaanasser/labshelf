/**
 * One-time, idempotent migration that exports annotations and theme preferences from SQLite into per-paper sidecar JSON files.
 *
 * @depends core/types, db/database, storage/data/paperDataStore
 * @dependents extension.ts, storage/data/index.ts, storage/index.ts
 */
import type { Annotation, PaperRecord } from "../../core/types.js";
import type { ResearchDatabase } from "../../db/database.js";
import type { PaperDataStore, PaperData } from "./paperDataStore.js";

/**
 * Merges annotation and theme data from SQLite into on-disk sidecars for every paper; safe to run repeatedly.
 * @usedBy extension.ts
 * @returns object with the count of papers whose sidecar was updated
 */
export async function migrateSidecarsFromDb(
  database: ResearchDatabase,
  dataStore: PaperDataStore,
  papers: PaperRecord[],
): Promise<{ migratedPapers: number }> {
  let migratedPapers = 0;

  for (const paper of papers) {
    const dbAnnotations = await database.getAnnotationsByPaper(paper.id);
    const dbTheme = await database.getThemePreference(paper.id);
    const sidecar = await dataStore.load(paper.id);

    const merged: PaperData = {
      annotations: mergeAnnotations(sidecar.annotations, dbAnnotations),
      theme: sidecar.theme !== "auto" ? sidecar.theme : dbTheme,
    };

    if (isUnchanged(sidecar, merged)) {
      continue;
    }
    await dataStore.save(paper.id, merged);
    migratedPapers += 1;
  }

  return { migratedPapers };
}

// Merges sidecar and DB annotation arrays by id; the sidecar entry wins on conflict.
function mergeAnnotations(sidecar: Annotation[], db: Annotation[]): Annotation[] {
  const byId = new Map<string, Annotation>();
  for (const a of db) {
    byId.set(a.id, a);
  }
  for (const a of sidecar) {
    byId.set(a.id, a);
  }
  return [...byId.values()];
}

// Returns true when the merged result is identical to the existing sidecar, so the file is not written unnecessarily.
function isUnchanged(before: PaperData, after: PaperData): boolean {
  return (
    before.theme === after.theme &&
    before.annotations.length === after.annotations.length
  );
}
