/**
 * Creates a paper entry in IndexedDB from resolved metadata and, when one was
 * found, the PDF bytes. Mirrors the VS Code PaperService.addPaperFromUri flow
 * adapted for the browser. A paper without a PDF is still a full entry
 * (metadata.yaml + bib.bib): the VS Code index treats any folder holding a
 * metadata.yaml as a paper, and the PDF can be attached later.
 * @depends @labshelf/core BibTeXService IFileSystem PaperRecord ResolvedMetadata,
 *          storage/indexedDbFileSystem, storage/paperRecordStore
 * @dependents capture/captureService, background/index
 */
import type { IFileSystem, PaperRecord, ResolvedMetadata } from "@labshelf/core";
import { BibTeXService, PDF_FILE, PAPERS_DIR } from "@labshelf/core";
import { IndexedDbFileSystem } from "../storage/indexedDbFileSystem";
import { listAllRecords, upsertRecord } from "../storage/paperRecordStore";

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

// Title words that make a poor cite-key suffix.
const STOPWORDS = new Set(["a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "from", "by", "at", "is", "are"]);

function slug(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Builds an "authorYearWord" cite key (aggarwal1986geometric), falling back
 * to a timestamp when the metadata has nothing to build from.
 * @usedBy addPaper, tests
 */
export function makeCiteKey(meta: ResolvedMetadata, fallbackTitle: string): string {
  const lastName = slug(meta.authors?.[0]?.trim().split(/\s+/).pop() ?? "");
  const year = meta.year ? String(meta.year) : "";
  const word = (meta.title ?? fallbackTitle)
    .split(/\s+/)
    .map(slug)
    .find((w) => w.length > 1 && !STOPWORDS.has(w)) ?? "";
  const key = `${lastName}${year}${word}`;
  return key || `paper${Date.now()}`;
}

/**
 * The key itself when free, otherwise key + a, b, … — BibTeX's convention for
 * two papers by the same author in the same year. The key is also the folder
 * name and the paper id, so a collision would overwrite another paper.
 * @usedBy addPaper, tests
 */
export function uniqueCiteKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 0; i < 26 * 26; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(97 + Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26));
    if (!taken.has(`${base}${suffix}`)) return `${base}${suffix}`;
  }
  return `${base}${Date.now()}`;
}

/** What the user attached while saving. */
export interface PaperExtras {
  tags?: string[];
  note?: string;
}

/**
 * Writes the PDF (if any), metadata.yaml and bib.bib to IndexedDB and updates
 * the metadata cache. The paper is queued for the next sync cycle; no Drive
 * upload happens here. `targetFolder` is the collection the paper lands in
 * (the library root by default), mirroring the VS Code "Add Paper Here".
 * @usedBy capture/captureService
 * @returns The newly created PaperRecord.
 */
export async function addPaper(
  pdfBytes: Uint8Array | undefined,
  meta: ResolvedMetadata,
  fallbackTitle: string,
  targetFolder: string = PAPERS_DIR,
  extras: PaperExtras = {},
): Promise<PaperRecord> {
  const idb = new IndexedDbFileSystem();
  const taken = new Set((await listAllRecords()).map((r) => r.id.toLowerCase()));
  const base = makeCiteKey(meta, fallbackTitle);
  let citeKey = uniqueCiteKey(base, taken);
  // A folder can exist without a cached record (a sync still in flight).
  while (await idb.stat(`${targetFolder}/${citeKey}`)) {
    taken.add(citeKey);
    citeKey = uniqueCiteKey(base, taken);
  }
  const folderPath = `${targetFolder}/${citeKey}`;

  const tags = [...new Set((extras.tags ?? []).map((t) => t.trim()).filter(Boolean))];
  const note = extras.note?.trim();
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
    ...(meta.keywords?.length ? { keywords: meta.keywords } : {}),
    ...(tags.length ? { tags } : {}),
    ...(note ? { note } : {}),
  };

  if (pdfBytes) await idb.writeFile(`${folderPath}/${PDF_FILE}`, pdfBytes);
  await new BibTeXService(new IdbTextAdapter(idb)).writePaperArtifacts(folderPath, paper, PDF_FILE);
  await upsertRecord(paper, folderPath);

  return paper;
}

/**
 * Attaches a PDF to a paper already in the library (the "Find PDF" / "Attach
 * PDF…" surfaces). The record is re-read by id from the live cache so a paper
 * moved during a long search is written at its CURRENT path — writing to a
 * stale path would leave an orphan folder the tree treats as a bogus paper. A
 * PDF that arrived meanwhile (e.g. by sync) is never overwritten.
 * @usedBy background/index (paper.findPdf, capture.attachPdf)
 * @returns The current record, and whether paper.pdf was written now.
 */
export async function attachPdfToPaper(
  paperId: string,
  bytes: Uint8Array,
): Promise<{ record: PaperRecord; written: boolean }> {
  const record = (await listAllRecords()).find((r) => r.id === paperId);
  if (!record) {
    throw new Error(`Paper "${paperId}" is no longer in the library.`);
  }
  const idb = new IndexedDbFileSystem();
  const pdfPath = `${record.path}/${PDF_FILE}`;
  if (await idb.stat(pdfPath)) {
    return { record, written: false };
  }
  await idb.writeFile(pdfPath, bytes);
  await new BibTeXService(new IdbTextAdapter(idb)).writePaperArtifacts(record.path, record, PDF_FILE);
  return { record, written: true };
}
