/**
 * Rebuilds the SQLite papers cache by scanning metadata.yaml files on disk.
 */
import * as vscode from "vscode";
import YAML from "yaml";

import type { PaperRecord, IResearchDatabase } from "@labshelf/core";
import { parseTextLayerInfo } from "@labshelf/core";
import { FileSystemService } from "../fileSystemService.js";
import type { ILibraryPaths } from "../paths/libraryPaths.js";

/**
 * Idempotent indexer that walks the library tree and upserts all papers into SQLite.
 * @usedBy extension.ts
 */
export class LibraryIndexer {
  constructor(
    private readonly paths: ILibraryPaths,
    private readonly fsService: FileSystemService,
    private readonly database: IResearchDatabase,
  ) {}

  /**
   * Scans papers/ and .research/papers/ and rebuilds the full SQLite cache via upsert.
   * @usedBy extension.ts
   * @returns the count of indexed papers
   */
  async rebuild(): Promise<{ papers: number }> {
    const papers = await this.scanPapers();

    for (const paper of papers) {
      await this.database.upsertPaper(paper);
    }

    return { papers: papers.length };
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
      // The directory listing already tells us whether the PDF is present, so
      // the honest-attachment flag costs no extra syscall. FileType is a bit
      // flag: a symlink to a file reports File|SymbolicLink, so test the bit.
      const hasPdf = entries.some(([name, type]) => name === "paper.pdf" && (type & vscode.FileType.File) !== 0);
      const paper = await this.readPaper(dir, vscode.Uri.joinPath(dir, "metadata.yaml"), hasPdf);
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
  // hasPdf is derived by walk() from the folder listing, never read from YAML.
  private async readPaper(folder: vscode.Uri, metadataUri: vscode.Uri, hasPdf: boolean): Promise<PaperRecord | null> {
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
    const keywords = stringList(meta.keywords);
    const textLayer = parseTextLayerInfo(meta.textLayer);
    const tags = stringList(meta.tags);
    return {
      id,
      title: typeof meta.title === "string" ? meta.title : id,
      path: folder.fsPath,
      citeKey: typeof meta.citekey === "string" ? meta.citekey : id,
      status: isStatus(meta.status) ? meta.status : "unread",
      hasPdf,
      ...(parseAuthors(meta.authors)),
      ...(typeof meta.year === "number" ? { year: meta.year } : {}),
      ...optStr(meta, "summary", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language"),
      ...(keywords.length ? { keywords } : {}),
      ...(textLayer ? { textLayer } : {}),
      ...(tags.length ? { tags } : {}),
      ...(typeof meta.note === "string" ? { note: meta.note } : {}),
    };
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
  const authors = stringList(value);
  return authors.length ? { authors } : {};
}

// Keeps the string entries of a YAML list; anything else yields an empty list.
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
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
