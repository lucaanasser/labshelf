/**
 * Rebuilds the SQLite cache by scanning metadata.yaml files and data.json sidecars on disk.
 *
 * @depends @labshelf/core, storage/fileSystemService, storage/paths/libraryPaths, storage/data/paperDataStore
 * @dependents extension.ts, storage/data/index.ts, storage/index.ts
 */
import * as vscode from "vscode";
import YAML from "yaml";

import type { PaperRecord, IResearchDatabase } from "@labshelf/core";
import { FileSystemService } from "../fileSystemService.js";
import type { ILibraryPaths } from "../paths/libraryPaths.js";
import { PaperDataStore } from "./paperDataStore.js";

/**
 * Idempotent indexer that walks the library tree and upserts all papers, annotations, and themes into SQLite.
 * @usedBy extension.ts
 */
export class LibraryIndexer {
  constructor(
    private readonly paths: ILibraryPaths,
    private readonly fsService: FileSystemService,
    private readonly database: IResearchDatabase,
    private readonly paperDataStore: PaperDataStore,
  ) {}

  /**
   * Scans papers/ and .research/papers/ and rebuilds the full SQLite cache via upsert.
   * @usedBy extension.ts
   * @returns object with counts of indexed papers and annotations
   */
  async rebuild(): Promise<{ papers: number; annotations: number }> {
    const papers = await this.scanPapers();
    let annotations = 0;

    for (const paper of papers) {
      await this.database.upsertPaper(paper);
      annotations += await this.indexPaperData(paper.id);
    }

    return { papers: papers.length, annotations };
  }

  // Walks papers/** collecting every folder that contains a metadata.yaml.
  private async scanPapers(): Promise<PaperRecord[]> {
    const found: PaperRecord[] = [];
    await this.walk(this.paths.papersRoot(), found);
    return found;
  }

  // Recursively walks a directory, collecting papers from folders that contain metadata.yaml.
  private async walk(dir: vscode.Uri, found: PaperRecord[]): Promise<void> {
    const entries = await this.fsService.readDirectory(dir);
    if (entries.some(([name, type]) => name === "metadata.yaml" && type === vscode.FileType.File)) {
      const paper = await this.readPaper(dir, vscode.Uri.joinPath(dir, "metadata.yaml"));
      if (paper) {
        found.push(paper);
      }
      return;
    }
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        await this.walk(vscode.Uri.joinPath(dir, name), found);
      }
    }
  }

  // Parses metadata.yaml; the paper id is the folder name (stable, == citeKey).
  private async readPaper(folder: vscode.Uri, metadataUri: vscode.Uri): Promise<PaperRecord | null> {
    let meta: Record<string, unknown>;
    try {
      const parsed = YAML.parse(await this.fsService.readText(metadataUri)) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      meta = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    const id = basename(folder);
    return {
      id,
      title: typeof meta.title === "string" ? meta.title : id,
      path: folder.fsPath,
      citeKey: typeof meta.citekey === "string" ? meta.citekey : id,
      status: isStatus(meta.status) ? meta.status : "unread",
      ...(parseAuthors(meta.authors)),
      ...(typeof meta.year === "number" ? { year: meta.year } : {}),
      ...optStr(meta, "summary", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language"),
    };
  }

  // Loads a paper's sidecar and replays its annotations and theme into the cache.
  private async indexPaperData(paperId: string): Promise<number> {
    const data = await this.paperDataStore.load(paperId);
    const existing = await this.database.getAnnotationsByPaper(paperId);
    for (const annotation of existing) {
      await this.database.deleteAnnotation(annotation.id);
    }
    for (const annotation of data.annotations) {
      await this.database.upsertAnnotation(annotation);
    }
    await this.database.setThemePreference(paperId, data.theme);
    return data.annotations.length;
  }
}

// Returns the last path segment of a URI (the folder name used as the paper id).
function basename(uri: vscode.Uri): string {
  const parts = uri.fsPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// Type guard that checks whether a value is a valid PaperRecord status string.
function isStatus(v: unknown): v is PaperRecord["status"] {
  return v === "unread" || v === "reading" || v === "done";
}

// Extracts a string array from a metadata authors field, returning an empty object if the field is absent.
function parseAuthors(value: unknown): { authors?: string[] } {
  if (Array.isArray(value)) {
    const authors = value.filter((a): a is string => typeof a === "string");
    return authors.length ? { authors } : {};
  }
  return {};
}

// Picks string-valued keys from a metadata record, omitting keys whose value is not a string.
function optStr(meta: Record<string, unknown>, ...keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (typeof meta[key] === "string") {
      out[key] = meta[key] as string;
    }
  }
  return out;
}
