/**
 * Volatile in-memory implementation of IResearchDatabase for tests and
 * graceful-degradation fallback when no persistent adapter is available.
 */
import type { IResearchDatabase } from "../ports/index.js";
import type { LogEntry, PaperRecord } from "../model/index.js";

export class InMemoryResearchDatabase implements IResearchDatabase {
  private readonly papers = new Map<string, PaperRecord>();
  private readonly logs: LogEntry[] = [];

  async initialize(): Promise<void> {
    return;
  }

  async upsertPaper(paper: PaperRecord): Promise<void> {
    this.papers.set(paper.id, paper);
  }

  async listPapers(): Promise<PaperRecord[]> {
    return [...this.papers.values()];
  }

  async deletePaper(id: string): Promise<void> {
    this.papers.delete(id);
  }

  async appendLog(entry: LogEntry): Promise<void> {
    this.logs.push(entry);
  }
}
