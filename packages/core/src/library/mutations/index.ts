/** Public API of library mutations: every change an app makes to papers and folders on disk, over injected ports. */
export type { BatchOutcome, MutationContext, PaperArtifactWriter, PaperRef, PathOps } from "./context.js";
export { posixPathOps } from "./pathOps.js";
export { readPaperOnDisk, statusOnDisk } from "./paperOnDisk.js";
export { writePaperRecord } from "./paperRecordWrite.js";
export type { RecordWriteOptions } from "./paperRecordWrite.js";
export { editPaperTags, setPaperStatus, updatePaperFields } from "./paperFields.js";
export type { FieldsBatchOutcome, PaperFieldsPatch } from "./paperFields.js";
export { movePapers, trashPapers } from "./paperMoves.js";
export type { MoveOutcome, PaperMove } from "./paperMoves.js";
export { createFolder, moveFolder, renameFolder, trashFolder } from "./folderOps.js";
export * from "./import/index.js";
export * from "./textLayer/index.js";
