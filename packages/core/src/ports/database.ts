/**
 * Research database interface implemented by SqliteResearchDatabase (VS Code)
 * and the IndexedDB-backed adapter (browser).
 */
import type { LogEntry, PaperRecord } from "../model/index.js";

export interface IResearchDatabase {
  initialize(): Promise<void>;
  upsertPaper(paper: PaperRecord): Promise<void>;
  listPapers(): Promise<PaperRecord[]>;
  deletePaper(id: string): Promise<void>;
  appendLog(entry: LogEntry): Promise<void>;
}
