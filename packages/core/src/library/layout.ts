/** The one definition of a LabShelf library on disk: folder and file names, and every well-known path built from them.
 * Runtime-neutral; each app passes its own path type and join function. */

export const PAPERS_DIR = "papers";
export const RESEARCH_DIR = ".research";
export const APPDATA_DIR = "appdata";

export const PDF_FILE = "paper.pdf";
export const METADATA_FILE = "metadata.yaml";
export const BIB_FILE = "bib.bib";
export const SIDECAR_FILE = "data.json";

export const INDEX_FILE = "index.sqlite";
export const APP_LOG_FILE = "app.log";
export const TERMINAL_LOG_FILE = "terminal.log";

export const SYNC_PROVIDER_ID = "google-drive";

export type Join<T> = (base: T, ...segments: string[]) => T;

/** String join with a fixed separator. Empty parts are skipped, so an empty root yields relative keys. */
export function joinWith(sep: "/" | "\\"): Join<string> {
  return (base, ...segments) => [base, ...segments].filter((part) => part !== "").join(sep);
}

export interface LibraryLayout<T> {
  readonly root: T;
  papersRoot(): T;
  researchRoot(): T;
  logsDir(): T;
  appLogPath(): T;
  terminalLogPath(): T;
  indexPath(): T;
  /** Scratch space for atomic writes: same volume as the library, outside both synced roots. */
  tmpDir(): T;
  paperDataRoot(): T;
  paperDataDir(paperId: string): T;
  paperDataPath(paperId: string): T;
  syncDir(): T;
  manifestPath(provider?: string): T;
  lockPath(provider?: string): T;
  lastRunPath(provider?: string): T;
  /** Folders a library needs. Creating them recursively, in order, yields the full structure. */
  requiredDirs(): T[];
  /** Folders whose presence marks a folder as a library. */
  markerDirs(): T[];
}

export function libraryLayout<T>(root: T, join: Join<T>): LibraryLayout<T> {
  const research = () => join(root, RESEARCH_DIR);
  const logsDir = () => join(research(), "logs");
  const paperDataRoot = () => join(research(), PAPERS_DIR);
  const syncDir = () => join(research(), "sync");
  const paperDataDir = (paperId: string) => join(paperDataRoot(), paperId);
  return {
    root,
    papersRoot: () => join(root, PAPERS_DIR),
    researchRoot: research,
    logsDir,
    appLogPath: () => join(logsDir(), APP_LOG_FILE),
    terminalLogPath: () => join(logsDir(), TERMINAL_LOG_FILE),
    indexPath: () => join(research(), INDEX_FILE),
    tmpDir: () => join(research(), "tmp"),
    paperDataRoot,
    paperDataDir,
    paperDataPath: (paperId) => join(paperDataDir(paperId), SIDECAR_FILE),
    syncDir,
    manifestPath: (provider = SYNC_PROVIDER_ID) => join(syncDir(), `${provider}.state.json`),
    lockPath: (provider = SYNC_PROVIDER_ID) => join(syncDir(), `${provider}.lock`),
    lastRunPath: (provider = SYNC_PROVIDER_ID) => join(syncDir(), `${provider}.last.json`),
    requiredDirs: () => [research(), logsDir(), paperDataRoot(), syncDir(), join(root, PAPERS_DIR)],
    markerDirs: () => [join(root, PAPERS_DIR), research()],
  };
}

export interface PaperFiles<T> { pdf: T; metadata: T; bib: T }

/** The files inside one paper folder. */
export function paperFiles<T>(folder: T, join: Join<T>): PaperFiles<T> {
  return { pdf: join(folder, PDF_FILE), metadata: join(folder, METADATA_FILE), bib: join(folder, BIB_FILE) };
}

/** The two synced roots, in the keys the sync engine uses. */
export function syncRoots<T>(l: LibraryLayout<T>): { library: T; appdata: T } {
  return { library: l.papersRoot(), appdata: l.paperDataRoot() };
}

/** Sync roots in the browser, where the IndexedDB file store keeps relative keys. */
export const BROWSER_SYNC_ROOTS = { library: PAPERS_DIR, appdata: APPDATA_DIR };
