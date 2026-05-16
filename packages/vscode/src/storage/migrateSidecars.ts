/**
 * Module: Sidecar Migration
 * Responsibility: One-time, idempotent export of annotations and theme
 *   preferences from the legacy SQLite database into per-paper sidecar JSON.
 * Dependencies: ResearchDatabase, PaperDataStore, core types
 */
import type { Annotation, PaperRecord } from "../core/types.js";
import type { ResearchDatabase } from "../db/database.js";
import type { PaperDataStore, PaperData } from "./paperDataStore.js";

// Exports legacy SQLite data to sidecars. Safe to run repeatedly: annotations
// are merged by id (no duplicates) and a non-default sidecar theme is kept.
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

// Sidecar wins on id conflict so a previous migration is never overwritten.
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

function isUnchanged(before: PaperData, after: PaperData): boolean {
  return (
    before.theme === after.theme &&
    before.annotations.length === after.annotations.length
  );
}
