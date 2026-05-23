/**
 * Reacts to paper CustomEvents emitted by the detail view. Handles open-pdf
 * (creates a Blob URL from the cached bytes and opens it in a new tab),
 * copy-cite (clipboard), status changes (rewrites metadata.yaml + record), and
 * delete (drops the record and the folder). Every mutation refreshes the
 * paper-record store so the views update in-place.
 *
 * @depends @labshelf/core PaperRecord BibTeXService IFileSystem,
 *          platform/browserApi, storage (IndexedDbFileSystem, paperRecordStore),
 *          controllers/dataController
 * @dependents library-page/index
 */
import type { IFileSystem, PaperRecord } from "@labshelf/core";
import { BibTeXService } from "@labshelf/core";
import { bx } from "../../platform/browserApi";
import {
  IndexedDbFileSystem,
  deleteRecord,
  listAllRecords,
  upsertRecord,
} from "../../storage";
import type { LibraryStore } from "../state/libraryStore";
import { refreshPapersSlice } from "./dataController";

const fs = new IndexedDbFileSystem();

// Wrap IndexedDbFileSystem in the text-oriented IFileSystem expected by
// BibTeXService so we can rewrite metadata.yaml after a status change.
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

const bib = new BibTeXService(new IdbTextAdapter(fs));

type Action = "open-pdf" | "copy-cite" | "status-reading" | "status-done" | "delete";

/** Attaches paper-action listeners against the global document. */
export function attachPaperController(store: LibraryStore): void {
  document.addEventListener("labshelf:paper-action", (e: Event) => {
    const { id, action } = (e as CustomEvent<{ id: string; action: Action }>).detail;
    void handle(store, id, action);
  });
}

async function handle(store: LibraryStore, id: string, action: Action): Promise<void> {
  const paper = (await listAllRecords()).find((p) => p.id === id);
  if (!paper) return;
  try {
    switch (action) {
      case "open-pdf": return await openPdf(paper);
      case "copy-cite": return await copyCite(store, paper);
      case "status-reading": return await setStatus(store, paper, "reading");
      case "status-done":    return await setStatus(store, paper, "done");
      case "delete": return await deletePaper(store, paper);
    }
  } catch (err) {
    store.set({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function openPdf(paper: PaperRecord): Promise<void> {
  const bytes = await fs.readFile(`${paper.path}/paper.pdf`);
  // ArrayBuffer copy avoids Blob seeing a transferred or detached buffer.
  const buffer = bytes.slice().buffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  await bx.tabs.create({ url });
}

async function copyCite(store: LibraryStore, paper: PaperRecord): Promise<void> {
  try {
    await navigator.clipboard.writeText(paper.citeKey);
    store.set({ error: null });
  } catch (err) {
    store.set({ error: `Clipboard blocked — ${(err as Error).message}` });
  }
}

async function setStatus(
  store: LibraryStore,
  paper: PaperRecord,
  status: PaperRecord["status"],
): Promise<void> {
  const next: PaperRecord = { ...paper, status };
  await upsertRecord(next, next.path);
  // Rewriting metadata.yaml + .bib ensures the sync engine uploads the change.
  await bib.writePaperArtifacts(next.path, next, "paper.pdf");
  await refreshPapersSlice(store);
}

async function deletePaper(store: LibraryStore, paper: PaperRecord): Promise<void> {
  if (!window.confirm(`Delete "${paper.title}" and its files?`)) return;
  await deleteRecord(paper.id);
  await fs.deleteDir(paper.path);
  store.set({ selectedPaperId: null });
  await refreshPapersSlice(store);
}
