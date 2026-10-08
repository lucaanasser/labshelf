/**
 * Generates BibTeX entries and YAML metadata sidecar files for imported papers.
 *
 * Operates on POSIX-style string paths through an injected IFileSystem, so the
 * same service runs against vscode.workspace.fs and the IndexedDB filesystem.
 */
import YAML from "yaml";

import type { IFileSystem } from "../../ports/index.js";
import type { PaperRecord } from "../../model/index.js";
import { PDF_FILE, joinWith, paperFiles } from "../../library/index.js";

const posixJoin = joinWith("/");

// Returns the trailing name of a path, accepting both POSIX and Windows separators.
function baseName(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash < 0 ? p : p.slice(lastSlash + 1);
}

// Keys writePaperArtifacts derives from the PaperRecord on every write.
const OWNED_KEYS = new Set([
  "title", "authors", "year", "path", "citekey", "status", "source", "journal", "publisher", "volume",
  "issue", "pages", "doi", "url", "issn", "language", "keywords", "summary", "textLayer",
]);

// Rewrites after import pass the library's own copy, "paper.pdf", which says
// nothing; the name the user imported is kept from the existing file.
function sourceName(existing: Record<string, unknown>, sourceFileName: string): string {
  const given = baseName(sourceFileName);
  if (given !== PDF_FILE) {
    return given;
  }
  const kept = existing["source"];
  return typeof kept === "string" && kept ? kept : given;
}

/** Generates and writes metadata.yaml and bib.bib sidecar files for a paper. */
export class BibTeXService {
  constructor(private readonly fs: IFileSystem) {}

  /**
   * Writes metadata.yaml and bib.bib into the paper folder.
   * @returns void
   */
  async writePaperArtifacts(paperFolder: string, paper: PaperRecord, sourceFileName: string): Promise<void> {
    const { metadata: metadataPath, bib: bibPath } = paperFiles(paperFolder, posixJoin);
    const existing = await this.readExisting(metadataPath);

    const metadata: Record<string, unknown> = {
      title: paper.title,
      authors: paper.authors ?? [],
      year: paper.year ?? null,
      path: paper.path,
      citekey: paper.citeKey,
      status: paper.status,
      source: sourceName(existing, sourceFileName),
    };

    if (paper.journal) { metadata["journal"] = paper.journal; }
    if (paper.publisher) { metadata["publisher"] = paper.publisher; }
    if (paper.volume) { metadata["volume"] = paper.volume; }
    if (paper.issue) { metadata["issue"] = paper.issue; }
    if (paper.pages) { metadata["pages"] = paper.pages; }
    if (paper.doi) { metadata["doi"] = paper.doi; }
    if (paper.url) { metadata["url"] = paper.url; }
    if (paper.issn) { metadata["issn"] = paper.issn; }
    if (paper.language) { metadata["language"] = paper.language; }
    // metadata.yaml is what the index is rebuilt from on every activation, so
    // a field left out here is a field silently dropped on the next start.
    if (paper.keywords?.length) { metadata["keywords"] = paper.keywords; }
    if (paper.summary) { metadata["summary"] = paper.summary; }
    if (paper.textLayer) { metadata["textLayer"] = paper.textLayer; }

    // Keys this service does not derive from the record (the browser's tags and
    // note, a hand edit) belong to whoever wrote them, so a rewrite from a
    // surface that does not know them — the VS Code index has no tag column —
    // carries them over instead of deleting them.
    const carried = Object.fromEntries(Object.entries(existing).filter(([key]) => !OWNED_KEYS.has(key)));
    if (paper.tags !== undefined) {
      delete carried["tags"];
      if (paper.tags.length) { metadata["tags"] = paper.tags; }
    }
    if (paper.note !== undefined) {
      delete carried["note"];
      if (paper.note.trim()) { metadata["note"] = paper.note; }
    }
    Object.assign(metadata, carried);

    // The bib `file` line must only point at a PDF that is actually on disk:
    // the browser writes a reference without paper.pdf when it finds none, so a
    // blind `file = {…/paper.pdf}` would send LaTeX and reference tools to a
    // file that is not there. Decide from the folder, not from the record.
    const pdfExists = await this.fs.exists(paperFiles(paperFolder, posixJoin).pdf);
    await this.fs.writeText(metadataPath, YAML.stringify(metadata));
    await this.fs.writeText(bibPath, this.generateBibTeX(paper, { includeFile: pdfExists }));
  }

  // The current sidecar as a plain object; empty when absent or unreadable,
  // since an unreadable sidecar is about to be replaced anyway.
  private async readExisting(metadataPath: string): Promise<Record<string, unknown>> {
    try {
      if (!(await this.fs.exists(metadataPath))) {
        return {};
      }
      const parsed = YAML.parse(await this.fs.readText(metadataPath)) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /**
   * Generates a BibTeX @article entry string for the given paper record.
   * @param options.includeFile Whether to emit the `file = {…/paper.pdf}` line.
   *   Defaults to true; writePaperArtifacts passes false when the folder holds
   *   no paper.pdf, so the entry never points at a file that does not exist.
   * @returns string
   */
  generateBibTeX(paper: PaperRecord, options: { includeFile?: boolean } = {}): string {
    const lines: string[] = [`@article{${paper.citeKey},`];

    lines.push(`  title = {${this.esc(paper.title)}},`);
    lines.push(`  author = {${this.formatAuthors(paper.authors)}},`);
    if (paper.year) { lines.push(`  year = {${paper.year}},`); }
    if (paper.journal) { lines.push(`  journal = {${this.esc(paper.journal)}},`); }
    if (paper.publisher) { lines.push(`  publisher = {${this.esc(paper.publisher)}},`); }
    if (paper.volume) { lines.push(`  volume = {${this.esc(paper.volume)}},`); }
    if (paper.issue) { lines.push(`  number = {${this.esc(paper.issue)}},`); }
    if (paper.pages) { lines.push(`  pages = {${this.esc(paper.pages)}},`); }
    if (paper.doi) { lines.push(`  doi = {${this.esc(paper.doi)}},`); }
    if (paper.issn) { lines.push(`  issn = {${this.esc(paper.issn)}},`); }
    if (paper.url) { lines.push(`  url = {${this.esc(paper.url)}},`); }
    if (paper.language) { lines.push(`  language = {${this.esc(paper.language)}},`); }
    if (paper.summary) { lines.push(`  note = {${this.esc(paper.summary)}},`); }
    if (options.includeFile !== false) {
      lines.push(`  file = {${this.esc(paperFiles(paper.path, posixJoin).pdf)}},`);
    }
    lines.push(`  keywords = {labshelf, imported}`);
    lines.push(`}`);

    return lines.join("\n");
  }

  // Strips curly braces from a string to avoid BibTeX syntax errors.
  private esc(value: string): string {
    return value.replace(/[{}]/g, "");
  }

  // Formats an author list as a BibTeX "A and B and C" string, defaulting to "Unknown".
  private formatAuthors(authors: string[] | undefined): string {
    const normalized = (authors ?? []).map((a) => a.trim()).filter(Boolean);
    return normalized.length > 0 ? normalized.map((a) => this.esc(a)).join(" and ") : "Unknown";
  }
}
