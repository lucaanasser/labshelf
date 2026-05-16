/**
 * Module: Library Indexer
 * Responsibility: Rebuild the SQLite cache from on-disk sources of truth —
 *   the metadata.yaml files under papers/ and the data.json sidecars under
 *   .research/papers/ — so index.sqlite never needs to be synchronized.
 * Dependencies: vscode, yaml, FileSystemService, ILibraryPaths, ResearchDatabase, PaperDataStore
 */
import * as vscode from "vscode";
import YAML from "yaml";

import type { PaperRecord } from "../core/types.js";
import type { ResearchDatabase } from "../db/database.js";
import { FileSystemService } from "./fileSystemService.js";
import type { ILibraryPaths } from "./libraryPaths.js";
import { PaperDataStore } from "./paperDataStore.js";

export class LibraryIndexer {
  constructor(
    private readonly paths: ILibraryPaths,
    private readonly fsService: FileSystemService,
    private readonly database: ResearchDatabase,
    private readonly paperDataStore: PaperDataStore,
  ) {}

  // Scans papers/ + .research/papers/ and rebuilds the full SQLite cache.
  // Idempotent: uses upsert so repeated runs never duplicate data.
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

function basename(uri: vscode.Uri): string {
  const parts = uri.fsPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function isStatus(v: unknown): v is PaperRecord["status"] {
  return v === "unread" || v === "reading" || v === "done";
}

function parseAuthors(value: unknown): { authors?: string[] } {
  if (Array.isArray(value)) {
    const authors = value.filter((a): a is string => typeof a === "string");
    return authors.length ? { authors } : {};
  }
  return {};
}

function optStr(meta: Record<string, unknown>, ...keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (typeof meta[key] === "string") {
      out[key] = meta[key] as string;
    }
  }
  return out;
}
