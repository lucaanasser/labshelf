/**
 * Platform-abstracting ports that apps implement and inject.
 */
export type { IFileSystem } from "./fileSystem.js";
export type { IResearchDatabase } from "./database.js";
export type { ILogger } from "./logger.js";
export type { LogSink } from "./logSink.js";
export type { LocalStat, LocalFileSystem } from "./localFileSystem.js";
export type { LockStore } from "./lockStore.js";
export type { SidecarPort } from "./sidecarPort.js";
