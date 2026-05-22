/**
 * Volatile in-memory implementation of IResearchDatabase for tests and
 * graceful-degradation fallback when no persistent adapter is available.
 *
 * @depends types, interfaces/database.ts
 * @dependents @labshelf/vscode extension (fallback), @labshelf/browser tests, integration tests
 */
import type { IResearchDatabase } from "../interfaces/database.js";
import type {
  Annotation,
  LogEntry,
  PaperRecord,
  PdfTheme,
} from "../types/index.js";

export class InMemoryResearchDatabase implements IResearchDatabase {
  private readonly papers = new Map<string, PaperRecord>();
  private readonly logs: LogEntry[] = [];
  private readonly annotations = new Map<string, Annotation>();
  private readonly themePreferences = new Map<string, PdfTheme>();

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

  async createAnnotation(
    data: Omit<Annotation, "id" | "createdAt" | "updatedAt">,
  ): Promise<Annotation> {
    const now = new Date().toISOString();
    const annotation: Annotation = {
      ...data,
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: now,
      updatedAt: now,
    };
    this.annotations.set(annotation.id, annotation);
    return annotation;
  }

  async upsertAnnotation(annotation: Annotation): Promise<void> {
    this.annotations.set(annotation.id, annotation);
  }

  async updateAnnotation(id: string, content: string): Promise<Annotation | null> {
    const existing = this.annotations.get(id);
    if (!existing) {
      return null;
    }
    const updated: Annotation = { ...existing, content, updatedAt: new Date().toISOString() };
    this.annotations.set(id, updated);
    return updated;
  }

  async deleteAnnotation(id: string): Promise<void> {
    this.annotations.delete(id);
  }

  async getAnnotationsByPaper(paperId: string): Promise<Annotation[]> {
    return [...this.annotations.values()]
      .filter((a) => a.paperId === paperId)
      .sort(
        (a, b) =>
          a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt),
      );
  }

  async getAnnotationsByPage(paperId: string, pageNumber: number): Promise<Annotation[]> {
    return [...this.annotations.values()]
      .filter((a) => a.paperId === paperId && a.pageNumber === pageNumber)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getThemePreference(paperId: string): Promise<PdfTheme> {
    return this.themePreferences.get(paperId) ?? "auto";
  }

  async setThemePreference(paperId: string, theme: PdfTheme): Promise<void> {
    this.themePreferences.set(paperId, theme);
  }
}
