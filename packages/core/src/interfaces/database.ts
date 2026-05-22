/**
 * Research database interface implemented by SqliteResearchDatabase (VS Code)
 * and the IndexedDB-backed adapter (browser).
 *
 * @depends types
 * @dependents paperService, libraryIndexer, sync flows
 */
import type { LogEntry, PaperRecord, Annotation, PdfTheme } from "../types/index.js";

export interface IResearchDatabase {
  initialize(): Promise<void>;
  upsertPaper(paper: PaperRecord): Promise<void>;
  listPapers(): Promise<PaperRecord[]>;
  deletePaper(id: string): Promise<void>;
  appendLog(entry: LogEntry): Promise<void>;

  // Annotations
  createAnnotation(annotation: Omit<Annotation, "id" | "createdAt" | "updatedAt">): Promise<Annotation>;
  /**
   * Inserts or replaces a full annotation record. Used by the indexer to rebuild the
   * cache from sidecars while preserving original ids and timestamps.
   */
  upsertAnnotation(annotation: Annotation): Promise<void>;
  updateAnnotation(id: string, content: string): Promise<Annotation | null>;
  deleteAnnotation(id: string): Promise<void>;
  getAnnotationsByPaper(paperId: string): Promise<Annotation[]>;
  getAnnotationsByPage(paperId: string, pageNumber: number): Promise<Annotation[]>;

  // Theme preferences
  getThemePreference(paperId: string): Promise<PdfTheme>;
  setThemePreference(paperId: string, theme: PdfTheme): Promise<void>;
}
