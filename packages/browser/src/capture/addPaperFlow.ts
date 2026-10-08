/**
 * Adds a paper to the IndexedDB library from resolved metadata and, when one was found, the PDF bytes, and attaches a
 * PDF to a paper already there. A paper without a PDF is still a full entry: any folder holding a metadata.yaml is a paper.
 */
import type { PaperRecord, ResolvedMetadata } from "@labshelf/core";
import { BibTeXService, PDF_FILE, PAPERS_DIR, claimCiteKey, makeCiteKey, normalizeTags } from "@labshelf/core";
import { BrowserLogger } from "../platform/logger";
import { IndexedDbFileSystem } from "../storage/indexedDbFileSystem";
import { createLibraryMutations } from "../storage/libraryMutations";
import { listAllRecords, upsertRecord } from "../storage/paperRecordStore";

const mutations = createLibraryMutations(new BrowserLogger("capture"));

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
  const citeKey = await claimCiteKey(
    makeCiteKey(meta, fallbackTitle),
    (await listAllRecords()).map((r) => r.id),
    async (key) => (await idb.stat(`${targetFolder}/${key}`)) !== undefined,
  );
  const folderPath = `${targetFolder}/${citeKey}`;

  const tags = normalizeTags(extras.tags ?? []);
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
  await new BibTeXService(idb).writePaperArtifacts(folderPath, paper, PDF_FILE);
  await upsertRecord(paper, folderPath);

  return paper;
}

/**
 * Attaches a PDF to a paper already in the library (the "Find PDF" / "Attach
 * PDF…" surfaces). The record is re-read by id from the live cache so a paper
 * moved during a long search is written at its CURRENT path — writing to a
 * stale path would leave an orphan folder the tree treats as a bogus paper. A
 * PDF that arrived meanwhile (e.g. by sync) is never overwritten.
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
  return { record: await mutations.recordPdfAttached(record), written: true };
}
