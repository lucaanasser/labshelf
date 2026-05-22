/**
 * SQLite-backed implementation of IResearchDatabase that persists papers, annotations, logs, and theme preferences.
 *
 * @depends @labshelf/core, storage/fileSystemService
 * @dependents extension.ts
 */
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as vscode from "vscode";

import type {
  LogEntry,
  PaperRecord,
  Annotation,
  AnnotationColor,
  AnnotationType,
  PdfTheme,
  IResearchDatabase,
} from "@labshelf/core";
import { FileSystemService } from "../storage/fileSystemService.js";

type AnnotationRow = {
  id: string;
  paperId: string;
  type: string;
  pageNumber: number;
  content: string;
  color: string | null;
  position: string | null;
  createdAt: string;
  updatedAt: string;
};

// Converts a raw SQLite annotation row into a typed Annotation, safely parsing the JSON position field.
function rowToAnnotation(row: AnnotationRow): Annotation {
  let position: Annotation['position'] | undefined;
  if (row.position) {
    try {
      const parsed = JSON.parse(row.position) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>;
        if (typeof p.x === 'number' && typeof p.y === 'number' &&
            typeof p.width === 'number' && typeof p.height === 'number') {
          position = { x: p.x, y: p.y, width: p.width, height: p.height };
        }
      }
    } catch {
      // ignore malformed position
    }
  }
  return {
    id: row.id,
    paperId: row.paperId,
    type: row.type as AnnotationType,
    pageNumber: row.pageNumber,
    content: row.content,
    ...(row.color ? { color: row.color as AnnotationColor } : {}),
    ...(position ? { position } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type PaperRow = {
  id: string;
  title: string;
  authors: string | null;
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
};

/**
 * Concrete IResearchDatabase backed by a WAL-mode SQLite file; applies additive schema migrations on initialize.
 * @usedBy extension.ts (via createSqliteResearchDatabase)
 */
export class SqliteResearchDatabase implements IResearchDatabase {
  private connection: DatabaseSync | undefined;

  constructor(
    private readonly databasePath: vscode.Uri,
    private readonly fileSystemService: FileSystemService,
  ) {}

  async initialize(): Promise<void> {
    await this.fileSystemService.ensureDirectory(vscode.Uri.file(path.dirname(this.databasePath.fsPath)));
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
        summary TEXT
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

    this.ensureColumns();
    this.ensureAnnotationsTable();
    this.ensureThemePreferencesTable();
  }

  async upsertPaper(paper: PaperRecord): Promise<void> {
    this.requireConnection().prepare(`
      INSERT INTO papers (id, title, authors, year, path, citekey, status, summary,
        journal, publisher, volume, issue, pages, doi, url, issn, language)
      VALUES (@id, @title, @authors, @year, @path, @citeKey, @status, @summary,
        @journal, @publisher, @volume, @issue, @pages, @doi, @url, @issn, @language)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
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
        language = excluded.language
    `).run({
      id: paper.id,
      title: paper.title,
      authors: paper.authors ? JSON.stringify(paper.authors) : null,
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
    });
  }

  async listPapers(): Promise<PaperRecord[]> {
    const rows = this.requireConnection().prepare(`
      SELECT id, title, authors, year, path, citekey, status, summary,
        journal, publisher, volume, issue, pages, doi, url, issn, language
      FROM papers
      ORDER BY title COLLATE NOCASE ASC
    `).all() as PaperRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      path: row.path,
      citeKey: row.citekey,
      status: row.status,
      ...(row.authors !== null ? { authors: this.parseAuthors(row.authors) } : {}),
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
    }));
  }

  async deletePaper(id: string): Promise<void> {
    this.requireConnection().prepare(`DELETE FROM papers WHERE id = ?`).run(id);
  }

  async createAnnotation(data: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Annotation> {
    const now = new Date().toISOString();
    const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.requireConnection().prepare(
      `INSERT INTO annotations (id, paperId, type, pageNumber, content, color, position, createdAt, updatedAt)
       VALUES (@id, @paperId, @type, @pageNumber, @content, @color, @position, @createdAt, @updatedAt)`,
    ).run({ id, paperId: data.paperId, type: data.type, pageNumber: data.pageNumber, content: data.content,
      color: data.color ?? null, position: data.position ? JSON.stringify(data.position) : null, createdAt: now, updatedAt: now });
    return { ...data, id, createdAt: now, updatedAt: now };
  }

  async upsertAnnotation(annotation: Annotation): Promise<void> {
    this.requireConnection().prepare(
      `INSERT INTO annotations (id, paperId, type, pageNumber, content, color, position, createdAt, updatedAt)
       VALUES (@id, @paperId, @type, @pageNumber, @content, @color, @position, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET paperId=excluded.paperId, type=excluded.type,
         pageNumber=excluded.pageNumber, content=excluded.content, color=excluded.color,
         position=excluded.position, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt`,
    ).run({ id: annotation.id, paperId: annotation.paperId, type: annotation.type,
      pageNumber: annotation.pageNumber, content: annotation.content, color: annotation.color ?? null,
      position: annotation.position ? JSON.stringify(annotation.position) : null,
      createdAt: annotation.createdAt, updatedAt: annotation.updatedAt });
  }

  async updateAnnotation(id: string, content: string): Promise<Annotation | null> {
    const now = new Date().toISOString();
    this.requireConnection().prepare(`UPDATE annotations SET content = @content, updatedAt = @updatedAt WHERE id = @id`).run({ id, content, updatedAt: now });
    return this.findAnnotation(id);
  }

  async deleteAnnotation(id: string): Promise<void> {
    this.requireConnection().prepare(`DELETE FROM annotations WHERE id = ?`).run(id);
  }

  async getAnnotationsByPaper(paperId: string): Promise<Annotation[]> {
    const rows = this.requireConnection().prepare(`SELECT * FROM annotations WHERE paperId = ? ORDER BY pageNumber ASC, createdAt ASC`).all(paperId) as AnnotationRow[];
    return rows.map(rowToAnnotation);
  }

  async getAnnotationsByPage(paperId: string, pageNumber: number): Promise<Annotation[]> {
    const rows = this.requireConnection().prepare(`SELECT * FROM annotations WHERE paperId = @paperId AND pageNumber = @pageNumber ORDER BY createdAt ASC`).all({ paperId, pageNumber }) as AnnotationRow[];
    return rows.map(rowToAnnotation);
  }

  async getThemePreference(paperId: string): Promise<PdfTheme> {
    const row = this.requireConnection().prepare(`SELECT theme FROM paperThemePreferences WHERE paperId = ?`).get(paperId) as { theme: string } | undefined;
    return (row?.theme as PdfTheme) ?? 'auto';
  }

  async setThemePreference(paperId: string, theme: PdfTheme): Promise<void> {
    const now = new Date().toISOString();
    this.requireConnection().prepare(
      `INSERT INTO paperThemePreferences (paperId, theme, updatedAt) VALUES (@paperId, @theme, @updatedAt)
       ON CONFLICT(paperId) DO UPDATE SET theme = excluded.theme, updatedAt = excluded.updatedAt`,
    ).run({ paperId, theme, updatedAt: now });
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

  // Adds any missing bibliographic columns to the papers table (additive migration).
  private ensureColumns(): void {
    const db = this.requireConnection();
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(papers)`).all() as Array<{ name: string }>).map((c) => c.name),
    );

    const newColumns: Array<[string, string]> = [
      ["authors", "TEXT"],
      ["journal", "TEXT"],
      ["publisher", "TEXT"],
      ["volume", "TEXT"],
      ["issue", "TEXT"],
      ["pages", "TEXT"],
      ["doi", "TEXT"],
      ["url", "TEXT"],
      ["issn", "TEXT"],
      ["language", "TEXT"],
    ];

    for (const [col, type] of newColumns) {
      if (!existing.has(col)) {
        db.prepare(`ALTER TABLE papers ADD COLUMN ${col} ${type}`).run();
      }
    }
  }

  // Fetches a single annotation row by id and converts it to an Annotation, or returns null.
  private findAnnotation(id: string): Annotation | null {
    const row = this.requireConnection().prepare(`SELECT * FROM annotations WHERE id = ?`).get(id) as AnnotationRow | undefined;
    return row ? rowToAnnotation(row) : null;
  }
  // Creates the annotations table and its paperId/pageNumber index if they do not exist.
  private ensureAnnotationsTable(): void {
    this.requireConnection().exec(`
      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        paperId TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('highlight', 'note', 'comment', 'tag')),
        pageNumber INTEGER NOT NULL,
        content TEXT NOT NULL,
        color TEXT CHECK (color IN ('yellow', 'green', 'blue', 'red', 'pink') OR color IS NULL),
        position TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_annotations_paperId_page ON annotations(paperId, pageNumber);
    `);
  }
  // Creates the paperThemePreferences table if it does not exist.
  private ensureThemePreferencesTable(): void {
    this.requireConnection().exec(`
      CREATE TABLE IF NOT EXISTS paperThemePreferences (
        paperId TEXT PRIMARY KEY,
        theme TEXT NOT NULL CHECK (theme IN ('auto', 'light', 'dark', 'sepia', 'high-contrast')),
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE
      );
    `);
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
 * @usedBy extension.ts
 * @returns uninitialised IResearchDatabase backed by the file at storageUri
 */
export async function createSqliteResearchDatabase(storageUri: vscode.Uri, fileSystemService: FileSystemService): Promise<IResearchDatabase> {
  return new SqliteResearchDatabase(storageUri, fileSystemService);
}
