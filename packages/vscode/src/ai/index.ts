/**
 * Public surface of the VSCode-side AI subsystem.
 *
 * @depends service, indexer, runtime, pdf
 * @dependents extension.ts, future commands and UI surfaces
 */
export * from "./service/index.js";
export * from "./indexer/index.js";
export * from "./runtime/index.js";
export * from "./pdf/index.js";
