/**
 * Generates BibTeX entries and YAML metadata sidecar files for imported papers.
 *
 * Operates on POSIX-style string paths through an injected IFileSystem, so the
 * same service runs against vscode.workspace.fs and the IndexedDB filesystem.
 *
 * @depends yaml, interfaces/fileSystem, types/paperRecord
 * @dependents paperService (vscode), addPaperFlow (browser)
 */
import YAML from "yaml";

import type { IFileSystem } from "../../interfaces/fileSystem.js";
import type { PaperRecord } from "../../types/paperRecord.js";

// POSIX-joins path segments with normalized single-slash separators.
function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");
}

// Returns the trailing name of a path, accepting both POSIX and Windows separators.
function baseName(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash < 0 ? p : p.slice(lastSlash + 1);
}

/** Generates and writes metadata.yaml and bib.bib sidecar files for a paper. */
export class BibTeXService {
  constructor(private readonly fs: IFileSystem) {}

  /**
   * Writes metadata.yaml and bib.bib into the paper folder.
   * @usedBy paperService, addPaperFlow
   * @returns void
   */
  async writePaperArtifacts(paperFolder: string, paper: PaperRecord, sourceFileName: string): Promise<void> {
    const metadataPath = posixJoin(paperFolder, "metadata.yaml");
    const bibPath = posixJoin(paperFolder, "bib.bib");

    const metadata: Record<string, unknown> = {
      title: paper.title,
      authors: paper.authors ?? [],
      year: paper.year ?? null,
      path: paper.path,
      citekey: paper.citeKey,
      status: paper.status,
      source: baseName(sourceFileName),
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

    await this.fs.writeText(metadataPath, YAML.stringify(metadata));
    await this.fs.writeText(bibPath, this.generateBibTeX(paper));
  }

  /**
   * Generates a BibTeX @article entry string for the given paper record.
   * @usedBy writePaperArtifacts, paperService
   * @returns string
   */
  generateBibTeX(paper: PaperRecord): string {
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
    lines.push(`  file = {${this.esc(posixJoin(paper.path, "paper.pdf"))}},`);
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
