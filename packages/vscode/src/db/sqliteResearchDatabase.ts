/**
 * SQLite-backed implementation of IResearchDatabase that persists papers and logs.
 */
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as vscode from "vscode";

import type { IFileSystem, LogEntry, PaperRecord, IResearchDatabase } from "@labshelf/core";
import { parseTextLayerInfo } from "@labshelf/core";
import { ensureAiSchema } from "./ai/aiSchema.js";

type PaperRow = {
  id: string;
  title: string;
  authors: string | null;
  keywords: string | null;
  year: number | null;
  path: string;
  citekey: string;
  status: PaperRecord["status"];
  summary: string | null;
  journal: string | null;
  publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  url: string | null;
  issn: string | null;
  language: string | null;
  text_layer: string | null;
  // 1 = PDF present on this device, 0 = known absent, NULL = unknown.
  has_pdf: number | null;
  tags: string | null;
  note: string | null;
};

/**
 * Concrete IResearchDatabase backed by a WAL-mode SQLite file; creates its schema on initialize.
 */
export class SqliteResearchDatabase implements IResearchDatabase {
  private connection: DatabaseSync | undefined;

  constructor(
    private readonly databasePath: vscode.Uri,
    private readonly fileSystem: IFileSystem,
  ) {}

  async initialize(): Promise<void> {
    await this.fileSystem.ensureDir(path.dirname(this.databasePath.fsPath));
    this.connection = new DatabaseSync(this.databasePath.fsPath);
    this.connection.exec("PRAGMA journal_mode = WAL");
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        authors TEXT,
        year INTEGER,
        path TEXT NOT NULL,
        citekey TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        keywords TEXT,
        journal TEXT,
        publisher TEXT,
        volume TEXT,
        issue TEXT,
        pages TEXT,
        doi TEXT,
        url TEXT,
        issn TEXT,
        language TEXT,
        -- JSON-encoded TextLayerInfo.
        text_layer TEXT,
        -- 1/0/NULL honest-attachment flag (see PaperRow.has_pdf).
        has_pdf INTEGER,
        -- The user's labels (JSON array) and free-text note, mirrored from metadata.yaml.
        tags TEXT,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        module TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        context TEXT NOT NULL
      );
    `);

    ensureAiSchema(this.connection);
  }

  /**
   * Exposes the underlying DatabaseSync handle to AI-side stores.
   *
   * The AI subsystem reads and writes its own tables (chunk_embeddings,
   * paper_metadata_ai, reading_events) declared by ensureAiSchema.
   * Sharing the connection avoids opening a second file handle on the same
   * SQLite database.
   *
   * @returns The active DatabaseSync handle.
   */
  rawConnection(): DatabaseSync {
    return this.requireConnection();
  }

  async upsertPaper(paper: PaperRecord): Promise<void> {
    this.requireConnection().prepare(`
      INSERT INTO papers (id, title, authors, year, path, citekey, status, summary,
        journal, publisher, volume, issue, pages, doi, url, issn, language, keywords, text_layer, has_pdf, tags, note)
      VALUES (@id, @title, @authors, @year, @path, @citeKey, @status, @summary,
        @journal, @publisher, @volume, @issue, @pages, @doi, @url, @issn, @language, @keywords, @textLayer, @hasPdf, @tags, @note)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        keywords = excluded.keywords,
        year = excluded.year,
        path = excluded.path,
        citekey = excluded.citekey,
        status = excluded.status,
        summary = excluded.summary,
        journal = excluded.journal,
        publisher = excluded.publisher,
        volume = excluded.volume,
        issue = excluded.issue,
        pages = excluded.pages,
        doi = excluded.doi,
        url = excluded.url,
        issn = excluded.issn,
        language = excluded.language,
        text_layer = excluded.text_layer,
        has_pdf = excluded.has_pdf,
        tags = excluded.tags,
        note = excluded.note
    `).run({
      id: paper.id,
      title: paper.title,
      authors: paper.authors ? JSON.stringify(paper.authors) : null,
      keywords: paper.keywords?.length ? JSON.stringify(paper.keywords) : null,
      year: paper.year ?? null,
      path: paper.path,
      citeKey: paper.citeKey,
      status: paper.status,
      summary: paper.summary ?? null,
      journal: paper.journal ?? null,
      publisher: paper.publisher ?? null,
      volume: paper.volume ?? null,
      issue: paper.issue ?? null,
      pages: paper.pages ?? null,
      doi: paper.doi ?? null,
      url: paper.url ?? null,
      issn: paper.issn ?? null,
      language: paper.language ?? null,
      textLayer: paper.textLayer ? JSON.stringify(paper.textLayer) : null,
      // undefined ("unknown") is stored as NULL so it keeps meaning present.
      hasPdf: paper.hasPdf === undefined ? null : paper.hasPdf ? 1 : 0,
      // NULL = not known here (see PaperRecord.tags), which an empty list is not.
      tags: paper.tags ? JSON.stringify(paper.tags) : null,
      note: paper.note ?? null,
    });
  }

  async listPapers(): Promise<PaperRecord[]> {
    const rows = this.requireConnection().prepare(`
      SELECT id, title, authors, keywords, year, path, citekey, status, summary,
        journal, publisher, volume, issue, pages, doi, url, issn, language, text_layer, has_pdf, tags, note
      FROM papers
      ORDER BY title COLLATE NOCASE ASC
    `).all() as PaperRow[];

    return rows.map((row) => {
      const textLayer = row.text_layer !== null ? this.parseTextLayer(row.text_layer) : undefined;
      return {
      id: row.id,
      title: row.title,
      path: row.path,
      citeKey: row.citekey,
      status: row.status,
      ...(row.authors !== null ? { authors: this.parseAuthors(row.authors) } : {}),
      ...(row.keywords !== null ? { keywords: this.parseAuthors(row.keywords) } : {}),
      ...(row.year !== null ? { year: row.year } : {}),
      ...(row.summary !== null ? { summary: row.summary } : {}),
      ...(row.journal !== null ? { journal: row.journal } : {}),
      ...(row.publisher !== null ? { publisher: row.publisher } : {}),
      ...(row.volume !== null ? { volume: row.volume } : {}),
      ...(row.issue !== null ? { issue: row.issue } : {}),
      ...(row.pages !== null ? { pages: row.pages } : {}),
      ...(row.doi !== null ? { doi: row.doi } : {}),
      ...(row.url !== null ? { url: row.url } : {}),
      ...(row.issn !== null ? { issn: row.issn } : {}),
      ...(row.language !== null ? { language: row.language } : {}),
      ...(textLayer ? { textLayer } : {}),
      ...(row.has_pdf !== null ? { hasPdf: row.has_pdf === 1 } : {}),
      ...(row.tags !== null ? { tags: this.parseAuthors(row.tags) } : {}),
      ...(row.note !== null ? { note: row.note } : {}),
      };
    });
  }

  async deletePaper(id: string): Promise<void> {
    this.requireConnection().prepare(`DELETE FROM papers WHERE id = ?`).run(id);
  }

  async appendLog(entry: LogEntry): Promise<void> {
    this.requireConnection().prepare(`INSERT INTO logs (timestamp, level, module, message, stack, context) VALUES (@timestamp, @level, @module, @message, @stack, @context)`).run({
      timestamp: entry.timestamp, level: entry.level, module: entry.module, message: entry.message,
      stack: entry.stack ?? null, context: JSON.stringify(entry.context),
    });
  }

  // Returns the live DatabaseSync or throws if initialize() was never called.
  private requireConnection(): DatabaseSync {
    if (!this.connection) { throw new Error("SQLite database has not been initialized"); }
    return this.connection;
  }

  // Deserializes the JSON-encoded text_layer column, dropping values it cannot trust.
  private parseTextLayer(raw: string): PaperRecord["textLayer"] {
    try {
      return parseTextLayerInfo(JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  // Deserializes the JSON-encoded authors column, returning an empty array on parse failure.
  private parseAuthors(rawAuthors: string): string[] {
    try {
      const parsed = JSON.parse(rawAuthors) as unknown;
      return Array.isArray(parsed) ? parsed.filter((author): author is string => typeof author === "string") : [];
    } catch {
      return [];
    }
  }
}

/**
 * Factory that instantiates a SqliteResearchDatabase without calling initialize, leaving that to the caller.
 * @returns uninitialised IResearchDatabase backed by the file at storageUri
 */
export async function createSqliteResearchDatabase(storageUri: vscode.Uri, fileSystem: IFileSystem): Promise<IResearchDatabase> {
  return new SqliteResearchDatabase(storageUri, fileSystem);
}
