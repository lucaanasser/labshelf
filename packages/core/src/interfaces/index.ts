/**
 * Barrel re-export for platform-abstracting interfaces.
 *
 * @depends fileSystem.ts, database.ts, logger.ts
 * @dependents @labshelf/core index, downstream packages
 */
export type { IFileSystem } from "./fileSystem.js";
export type { IResearchDatabase } from "./database.js";
export type { ILogger } from "./logger.js";
