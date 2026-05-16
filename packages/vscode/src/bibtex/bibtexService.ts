/** Generates BibTeX entries and YAML metadata sidecar files for imported papers. @depends yaml, vscode, core/types, storage/fileSystemService. @dependents extension, core/paperService */
import * as path from "node:path";
import * as vscode from "vscode";
import YAML from "yaml";

import type { PaperRecord } from "../core/types.js";
import { FileSystemService } from "../storage/fileSystemService.js";

/** Generates and writes metadata.yaml and bib.bib sidecar files for a paper. @usedBy extension, paperService. */
export class BibTeXService {
  constructor(private readonly fsService: FileSystemService) {}

  /** Writes metadata.yaml and bib.bib into the paper folder. @usedBy paperService. @returns void */
  async writePaperArtifacts(paperFolder: vscode.Uri, paper: PaperRecord, sourceFileName: string): Promise<void> {
    const metadataPath = vscode.Uri.joinPath(paperFolder, "metadata.yaml");
    const bibPath = vscode.Uri.joinPath(paperFolder, "bib.bib");

    const metadata: Record<string, unknown> = {
      title: paper.title,
      authors: paper.authors ?? [],
      year: paper.year ?? null,
      path: paper.path,
      citekey: paper.citeKey,
      status: paper.status,
      source: path.basename(sourceFileName),
    };

    if (paper.journal) { metadata.journal = paper.journal; }
    if (paper.publisher) { metadata.publisher = paper.publisher; }
    if (paper.volume) { metadata.volume = paper.volume; }
    if (paper.issue) { metadata.issue = paper.issue; }
    if (paper.pages) { metadata.pages = paper.pages; }
    if (paper.doi) { metadata.doi = paper.doi; }
    if (paper.url) { metadata.url = paper.url; }
    if (paper.issn) { metadata.issn = paper.issn; }
    if (paper.language) { metadata.language = paper.language; }

    await this.fsService.writeText(metadataPath, YAML.stringify(metadata));
    await this.fsService.writeText(bibPath, this.generateBibTeX(paper));
  }

  /** Generates a BibTeX @article entry string for the given paper record. @usedBy writePaperArtifacts, paperService. @returns string */
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
    lines.push(`  file = {${this.esc(path.join(paper.path, "paper.pdf"))}},`);
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
