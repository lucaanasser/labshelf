/**
 * Module: Paper Data Store
 * Responsibility: Own the per-paper sidecar JSON (.research/papers/<id>/data.json),
 *   the single source of truth for annotations and theme. SQLite is only a cache.
 * Dependencies: vscode (Uri), FileSystemService, core types
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

  // Reads the sidecar; a missing file means "paper has no data yet".
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

  // Persists the full sidecar, creating the paper's data folder if needed.
  async save(paperId: string, data: PaperData): Promise<void> {
    await this.fsService.ensureDirectory(this.dataDir(paperId));
    const payload: PaperData = {
      annotations: data.annotations,
      theme: data.theme,
    };
    await this.fsService.writeText(this.dataPath(paperId), JSON.stringify(payload, null, 2));
  }

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

  async deleteAnnotation(paperId: string, id: string): Promise<void> {
    const current = await this.load(paperId);
    const filtered = current.annotations.filter((a) => a.id !== id);
    if (filtered.length === current.annotations.length) {
      return;
    }
    current.annotations = filtered;
    await this.save(paperId, current);
  }

  async getAnnotations(paperId: string): Promise<Annotation[]> {
    const data = await this.load(paperId);
    return [...data.annotations].sort(
      (a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt),
    );
  }

  async getAnnotationsByPage(paperId: string, page: number): Promise<Annotation[]> {
    const data = await this.load(paperId);
    return data.annotations
      .filter((a) => a.pageNumber === page)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async setTheme(paperId: string, theme: PdfTheme): Promise<void> {
    const current = await this.load(paperId);
    current.theme = theme;
    await this.save(paperId, current);
  }

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
