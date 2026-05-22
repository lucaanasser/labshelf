/**
 * Creates a paper entry in IndexedDB from resolved metadata and raw PDF bytes.
 * Mirrors the VSCode PaperService.addPaperFromUri flow adapted for the browser.
 * @depends @labshelf/core BibTeXService IFileSystem PaperRecord ResolvedMetadata,
 *          storage/indexedDbFileSystem, storage/paperRecordStore
 * @dependents capture/captureService
 */
import type { IFileSystem, PaperRecord, ResolvedMetadata } from "@labshelf/core";
import { BibTeXService } from "@labshelf/core";
import { IndexedDbFileSystem } from "../storage/indexedDbFileSystem";
import { upsertRecord } from "../storage/paperRecordStore";

// Wraps IndexedDbFileSystem to satisfy the IFileSystem text interface expected by BibTeXService.
class IdbTextAdapter implements IFileSystem {
  constructor(private readonly idb: IndexedDbFileSystem) {}
  async ensureDir(_path: string): Promise<void> {}
  async writeText(path: string, text: string): Promise<void> {
    await this.idb.writeFile(path, new TextEncoder().encode(text));
  }
  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.idb.readFile(path));
  }
  async exists(path: string): Promise<boolean> {
    return (await this.idb.stat(path)) !== undefined;
  }
}

// Produces a "AuthorYearWord" cite key from resolved metadata, falling back to a timestamp.
function makeCiteKey(meta: ResolvedMetadata, fallbackTitle: string): string {
  const lastName =
    meta.authors?.[0]?.split(" ").pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  const year = meta.year ? String(meta.year) : "";
  const word = (meta.title ?? fallbackTitle)
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z]/g, "") ?? "";
  const key = `${lastName}${year}${word}`;
  return key || `paper${Date.now()}`;
}

/**
 * Writes PDF, metadata.yaml, and bib.bib to IndexedDB and updates the
 * metadata cache. The paper is queued for the next sync cycle; no Drive
 * upload happens here.
 * @usedBy capture/captureService
 * @returns The newly created PaperRecord.
 */
export async function addPaper(
  pdfBytes: Uint8Array,
  meta: ResolvedMetadata,
  fallbackTitle: string,
): Promise<PaperRecord> {
  const citeKey = makeCiteKey(meta, fallbackTitle);
  const folderPath = `papers/${citeKey}`;
  const idb = new IndexedDbFileSystem();

  const paper: PaperRecord = {
    id: citeKey,
    title: meta.title ?? fallbackTitle,
    citeKey,
    path: folderPath,
    status: "unread",
    ...(meta.authors?.length ? { authors: meta.authors } : {}),
    ...(meta.year ? { year: meta.year } : {}),
    ...(meta.summary ? { summary: meta.summary } : {}),
    ...(meta.journal ? { journal: meta.journal } : {}),
    ...(meta.publisher ? { publisher: meta.publisher } : {}),
    ...(meta.volume ? { volume: meta.volume } : {}),
    ...(meta.issue ? { issue: meta.issue } : {}),
    ...(meta.pages ? { pages: meta.pages } : {}),
    ...(meta.doi ? { doi: meta.doi } : {}),
    ...(meta.url ? { url: meta.url } : {}),
    ...(meta.issn ? { issn: meta.issn } : {}),
    ...(meta.language ? { language: meta.language } : {}),
  };

  await idb.writeFile(`${folderPath}/paper.pdf`, pdfBytes);
  await new BibTeXService(new IdbTextAdapter(idb)).writePaperArtifacts(
    folderPath,
    paper,
    "paper.pdf",
  );
  await upsertRecord(paper, folderPath);

  return paper;
}
