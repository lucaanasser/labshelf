/**
 * Root component of the library page. Builds the three-column layout shell —
 * header (title + breadcrumb + global actions), body (sidebar / main / aside),
 * footer (status bar) — and exposes mount points for the views to populate.
 *
 * Wires header actions (search, sync now, capture clipboard) to the store and
 * the background runtime; the individual views render into the mount points
 * registered in {@link LibraryAppMounts}.
 *
 * @depends platform/browserApi, platform/runtimeMessages, state/libraryStore
 * @dependents library-page/index
 */
import { bx } from "../platform/browserApi";
import type {
  RuntimeMessage,
  RuntimeResponse,
  SyncStatusData,
} from "../platform/runtimeMessages";
import type { LibraryStore } from "./state/libraryStore";

export interface LibraryAppMounts {
  sidebar: HTMLElement;
  main: HTMLElement;
  aside: HTMLElement;
  breadcrumb: HTMLElement;
  footerLeft: HTMLElement;
  footerRight: HTMLElement;
}

async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

/** Builds the layout DOM, attaches header handlers, returns the view mounts. */
export function buildApp(root: HTMLElement, store: LibraryStore): LibraryAppMounts {
  root.innerHTML = `
    <div class="app">
      <header class="app__header">
        <span class="app__title">LABSHELF</span>
        <nav class="app__breadcrumb" id="breadcrumb" aria-label="Folder breadcrumb"></nav>
        <div class="app__actions">
          <input id="search" type="search" placeholder="SEARCH TITLE / AUTHOR" aria-label="Search papers" />
          <button id="sync-now" type="button">SYNC</button>
          <button id="capture-clip" type="button" class="btn--accent">+ ADD</button>
        </div>
      </header>
      <div class="app__body">
        <aside class="app__sidebar" id="sidebar"></aside>
        <main class="app__main" id="main"></main>
        <aside class="app__aside" id="aside"></aside>
      </div>
      <footer class="app__footer">
        <div class="app__footer__left" id="footer-left"></div>
        <div class="app__footer__right" id="footer-right"></div>
      </footer>
    </div>
  `;

  const $ = (id: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (!el) throw new Error(`Missing element #${id}`);
    return el;
  };

  const search = $("search") as HTMLInputElement;
  search.addEventListener("input", () => store.set({ search: search.value }));

  $("sync-now").addEventListener("click", () => { void triggerSync(store); });
  $("capture-clip").addEventListener("click", () => { void triggerCapture(store); });

  return {
    sidebar: $("sidebar"),
    main: $("main"),
    aside: $("aside"),
    breadcrumb: $("breadcrumb"),
    footerLeft: $("footer-left"),
    footerRight: $("footer-right"),
  };
}

async function triggerSync(store: LibraryStore): Promise<void> {
  try {
    const status = await send<SyncStatusData>({ type: "sync.now" });
    store.set({ sync: status, error: null });
  } catch (err) {
    store.set({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function triggerCapture(store: LibraryStore): Promise<void> {
  try {
    await send({ type: "capture.activeTab" });
  } catch (err) {
    store.set({ error: err instanceof Error ? err.message : String(err) });
  }
}
