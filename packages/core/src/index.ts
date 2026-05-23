/**
 * Public surface of @labshelf/core — shared domain types, platform-abstracting
 * interfaces, the cross-runtime event bus, and the in-memory database fallback.
 *
 * @depends types, interfaces, events, db
 * @dependents @labshelf/vscode, @labshelf/browser
 */
export * from "./types/index.js";
export * from "./interfaces/index.js";
export * from "./events/index.js";
export * from "./db/index.js";
export * from "./io/index.js";
export * from "./sync/index.js";
export * from "./library/index.js";
