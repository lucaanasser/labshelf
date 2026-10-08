/**
 * Opens a paper in the reader page, one tab per paper like one VS Code panel per paper: when a reader tab already
 * shows the paper it is brought to the front (and moved to the requested page) instead of opening a second copy.
 * Open tabs are found through extension.getViews, so no "tabs" permission is needed.
 *
 * @depends platform/browserApi
 * @dependents library-page/controllers/paperController, reader/index (exposes the handle)
 */
import { bx } from "../platform/browserApi";

export const READER_PAGE = "reader/index.html";

/** What each reader tab publishes on its window for readerTabs to find it. */
export interface ReaderWindowHandle {
  paperId: string;
  reveal(page?: number): Promise<void>;
}

declare global {
  interface Window { labshelfReader?: ReaderWindowHandle }
}

/**
 * @usedBy openReader, background or tests that need the reader address
 * @returns the extension URL of the reader page for a paper.
 */
export function readerUrl(paperId: string, page?: number): string {
  const q = new URLSearchParams({ paper: paperId });
  if (page && Number.isInteger(page) && page > 0) q.set("page", String(page));
  return `${bx.runtime.getURL(READER_PAGE)}?${q.toString()}`;
}

/**
 * Parses the reader page's query string.
 * @usedBy reader/index
 * @returns the paper id (null when absent) and an optional page.
 */
export function parseReaderQuery(search: string): { paperId: string | null; page?: number } {
  const q = new URLSearchParams(search);
  const paperId = q.get("paper")?.trim() || null;
  const page = Number(q.get("page"));
  return Number.isInteger(page) && page > 0 ? { paperId, page } : { paperId };
}

/**
 * @usedBy library-page/controllers/paperController
 * @returns resolves once the paper's reader tab is in front.
 */
export async function openReader(paperId: string, page?: number): Promise<void> {
  const views = (bx.extension.getViews?.({ type: "tab" }) ?? []) as Window[];
  for (const view of views) {
    let handle: ReaderWindowHandle | undefined;
    try { handle = view.labshelfReader; } catch { handle = undefined; }
    if (handle?.paperId === paperId) {
      await handle.reveal(page);
      return;
    }
  }
  await bx.tabs.create({ url: readerUrl(paperId, page) });
}
