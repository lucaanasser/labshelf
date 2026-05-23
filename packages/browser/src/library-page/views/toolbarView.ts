/**
 * Renders the breadcrumb (top centre) and footer status bar (bottom row).
 * Breadcrumb crumbs are clickable and navigate the selected folder; footer
 * surfaces sync state on the left and library size on the right.
 *
 * @depends state/libraryStore, views/emptyStateView
 * @dependents library-page/index
 */
import type { LibraryStore } from "../state/libraryStore";
import { escapeHtml } from "./emptyStateView";

const ROOT_PATH = "papers";

/** Mounts the breadcrumb into the header slot and returns an unsubscribe fn. */
export function mountBreadcrumb(container: HTMLElement, store: LibraryStore): () => void {
  container.addEventListener("click", (e) => {
    const crumb = (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
    if (!crumb) return;
    const path = crumb.dataset["path"] ?? ROOT_PATH;
    store.set({ selectedFolder: path, selectedPaperId: null });
  });
  return store.select((s) => s.selectedFolder, (path) => render(container, path));
}

function render(container: HTMLElement, path: string): void {
  const tokens = path.split("/").filter(Boolean);
  const parts = tokens.map((token, i) => {
    const subPath = tokens.slice(0, i + 1).join("/");
    const isLast = i === tokens.length - 1;
    const cls = isLast ? "app__breadcrumb__current" : "app__breadcrumb__crumb";
    return `<span class="${cls}" data-path="${escapeHtml(subPath)}">${escapeHtml(token.toUpperCase())}</span>`;
  });
  const sep = `<span class="app__breadcrumb__sep">›</span>`;
  container.innerHTML = parts.length > 0 ? parts.join(sep) : `<span class="app__breadcrumb__current">LIBRARY</span>`;
}

/** Mounts the footer status pills (left + right) and returns an unsubscribe fn. */
export function mountFooter(
  leftEl: HTMLElement,
  rightEl: HTMLElement,
  store: LibraryStore,
): () => void {
  const dispose = store.select(
    (s) => ({ sync: s.sync, papers: s.papers, error: s.error } as const),
    (slice) => {
      leftEl.innerHTML = renderLeft(slice.sync, slice.error);
      rightEl.innerHTML = renderRight(slice.papers.length);
    },
  );
  return dispose;
}

function renderLeft(sync: ReturnType<LibraryStore["get"]>["sync"], error: string | null): string {
  if (error) return `<span class="pill pill--warn">ERR · ${escapeHtml(error)}</span>`;
  if (!sync) return `<span class="muted">READY</span>`;
  if (sync.syncing) return `<span class="pill pill--accent">▶ SYNCING</span>`;
  if (sync.lastError) return `<span class="pill pill--warn">SYNC ERR · ${escapeHtml(sync.lastError)}</span>`;
  if (sync.lastSyncTime) {
    const t = new Date(sync.lastSyncTime).toLocaleTimeString();
    return `<span class="pill pill--ok">• DRIVE · SYNCED ${escapeHtml(t)}</span>`;
  }
  if (sync.connected) return `<span class="pill">• DRIVE · CONNECTED</span>`;
  return `<span class="muted">• DISCONNECTED</span>`;
}

function renderRight(count: number): string {
  return `<span class="muted">${count} PAPER${count === 1 ? "" : "S"}</span>`;
}
