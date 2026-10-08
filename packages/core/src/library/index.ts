/** Public API of the library domain: collection folders, paper metadata and the on-disk layout. */
export {
  FolderService,
  isUnderDir,
} from "./folderService.js";
export type {
  IPaperRecordIndex,
  FolderRelocation,
  FolderRemoval,
} from "./folderService.js";
export { paperRecordFromMetadata, parsePaperMetadata } from "./paperMetadata.js";
export type { PaperLocation } from "./paperMetadata.js";
export {
  PAPERS_DIR, RESEARCH_DIR, APPDATA_DIR,
  PDF_FILE, METADATA_FILE, BIB_FILE, SIDECAR_FILE,
  INDEX_FILE, APP_LOG_FILE, TERMINAL_LOG_FILE,
  SYNC_PROVIDER_ID, BROWSER_SYNC_ROOTS,
  joinWith, libraryLayout, paperFiles, syncRoots,
} from "./layout.js";
export type { Join, LibraryLayout, PaperFiles } from "./layout.js";
