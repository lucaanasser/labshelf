/**
 * Public surface of the reader's DOM-free modules, compiled to dist/ for the VS Code extension host and the browser host.
 * The reader UI itself is not exported here: hosts bundle it from src/webview/ (see src/webview/reader.ts).
 *
 * @depends shared/*
 * @dependents vscode pdf-viewer/*, vscode storage/data/paperDataStore.ts, vscode extension.ts, browser reader/*, browser options/index.ts
 */
export * from "./protocol.js";
export * from "./readingState.js";
export * from "./themePresets.js";
export * from "./citationFormat.js";
export * from "./annotationsMarkdown.js";
export * from "./readerPrefs.js";
export * from "./paperData.js";
export * from "./shell.js";
