/**
 * Owns the per-paper sidecar JSON (.research/papers/<id>/data.json), the authoritative source for annotations and theme preferences.
 *
 * @depends core/types, storage/fileSystemService
 * @dependents extension.ts, pdf-viewer/AnnotationManager.ts, pdf-viewer/ThemeManager.ts, storage/data/index.ts, storage/data/libraryIndexer.ts, storage/data/migrateSidecars.ts, storage/index.ts
 */
import * as vscode from "vscode";
import { randomUUID } from "crypto";

import type { Annotation, PdfTheme } from "../../core/types.js";
import { FileSystemService } from "../fileSystemService.js";

export interface PaperData {
  annotations: Annotation[];
  theme: PdfTheme;
}

function emptyData(): PaperData {
  return { annotations: [], theme: "auto" };
}

/**
 * Read/write accessor for a paper's sidecar JSON, the single source of truth for its annotations and theme.
 * @usedBy extension.ts, pdf-viewer/AnnotationManager.ts, pdf-viewer/ThemeManager.ts, storage/data/libraryIndexer.ts, storage/data/migrateSidecars.ts
 */
export class PaperDataStore {
  constructor(
    private readonly researchRoot: vscode.Uri,
    private readonly fsService: FileSystemService,
  ) {}

  // Folder owning one paper's sidecar: <researchRoot>/papers/<paperId>/
  private dataDir(paperId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.researchRoot, "papers", paperId);
  }

  // Sidecar file path: <researchRoot>/papers/<paperId>/data.json
  private dataPath(paperId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.dataDir(paperId), "data.json");
  }

  /**
   * Reads the sidecar JSON for a paper, returning empty data if the file is absent or corrupt.
   * @usedBy pdf-viewer/AnnotationManager.ts, pdf-viewer/ThemeManager.ts, storage/data/libraryIndexer.ts, storage/data/migrateSidecars.ts
   * @returns PaperData containing annotations and theme
   */
  async load(paperId: string): Promise<PaperData> {
    const uri = this.dataPath(paperId);
    if (!(await this.fsService.exists(uri))) {
      return emptyData();
    }
    try {
      const parsed = JSON.parse(await this.fsService.readText(uri)) as unknown;
      return normalize(parsed);
    } catch {
      return emptyData();
    }
  }

  /**
   * Writes the full sidecar JSON to disk, creating the paper data directory if needed.
   * @usedBy storage/data/migrateSidecars.ts, internally by mutation methods
   * @returns void
   */
  async save(paperId: string, data: PaperData): Promise<void> {
    await this.fsService.ensureDirectory(this.dataDir(paperId));
    const payload: PaperData = {
      annotations: data.annotations,
      theme: data.theme,
    };
    await this.fsService.writeText(this.dataPath(paperId), JSON.stringify(payload, null, 2));
  }

  /**
   * Creates a new annotation with a generated id and current timestamps and persists the sidecar.
   * @usedBy pdf-viewer/AnnotationManager.ts
   * @returns the created Annotation
   */
  async addAnnotation(
    paperId: string,
    data: Omit<Annotation, "id" | "createdAt" | "updatedAt">,
  ): Promise<Annotation> {
    const now = new Date().toISOString();
    const annotation: Annotation = {
      ...data,
      paperId,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const current = await this.load(paperId);
    current.annotations.push(annotation);
    await this.save(paperId, current);
    return annotation;
  }

  /**
   * Updates the content and updatedAt timestamp of an existing annotation; returns null if not found.
   * @usedBy pdf-viewer/AnnotationManager.ts
   * @returns the updated Annotation, or null
   */
  async updateAnnotation(paperId: string, id: string, content: string): Promise<Annotation | null> {
    const current = await this.load(paperId);
    const index = current.annotations.findIndex((a) => a.id === id);
    if (index === -1) {
      return null;
    }
    const updated: Annotation = {
      ...current.annotations[index]!,
      content,
      updatedAt: new Date().toISOString(),
    };
    current.annotations[index] = updated;
    await this.save(paperId, current);
    return updated;
  }

  /**
   * Removes an annotation from the sidecar; no-ops silently if the id does not exist.
   * @usedBy pdf-viewer/AnnotationManager.ts
   * @returns void
   */
  async deleteAnnotation(paperId: string, id: string): Promise<void> {
    const current = await this.load(paperId);
    const filtered = current.annotations.filter((a) => a.id !== id);
    if (filtered.length === current.annotations.length) {
      return;
    }
    current.annotations = filtered;
    await this.save(paperId, current);
  }

  /**
   * Returns all annotations for a paper sorted by page number then creation time.
   * @usedBy pdf-viewer/AnnotationManager.ts
   * @returns sorted Annotation array
   */
  async getAnnotations(paperId: string): Promise<Annotation[]> {
    const data = await this.load(paperId);
    return [...data.annotations].sort(
      (a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt),
    );
  }

  /**
   * Returns annotations for a specific page of a paper, sorted by creation time.
   * @usedBy pdf-viewer/AnnotationManager.ts
   * @returns Annotation array for the given page
   */
  async getAnnotationsByPage(paperId: string, page: number): Promise<Annotation[]> {
    const data = await this.load(paperId);
    return data.annotations
      .filter((a) => a.pageNumber === page)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Persists the chosen PDF theme for a paper in its sidecar.
   * @usedBy pdf-viewer/ThemeManager.ts
   * @returns void
   */
  async setTheme(paperId: string, theme: PdfTheme): Promise<void> {
    const current = await this.load(paperId);
    current.theme = theme;
    await this.save(paperId, current);
  }

  /**
   * Returns the stored PDF theme for a paper, defaulting to 'auto' when no sidecar exists.
   * @usedBy pdf-viewer/ThemeManager.ts
   * @returns PdfTheme value
   */
  async getTheme(paperId: string): Promise<PdfTheme> {
    return (await this.load(paperId)).theme;
  }
}

const VALID_THEMES: PdfTheme[] = ["auto", "light", "dark", "sepia", "high-contrast"];

// Defensive normalization so a corrupt sidecar never throws.
function normalize(parsed: unknown): PaperData {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyData();
  }
  const obj = parsed as Record<string, unknown>;
  const annotations = Array.isArray(obj.annotations)
    ? (obj.annotations.filter(
        (a) => a && typeof a === "object" && typeof (a as Annotation).id === "string",
      ) as Annotation[])
    : [];
  const theme = VALID_THEMES.includes(obj.theme as PdfTheme) ? (obj.theme as PdfTheme) : "auto";
  return { annotations, theme };
}
