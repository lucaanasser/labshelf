# Directory Reference

This page explains the purpose of the main directories in the repository.

## `packages/core/src/`

Platform-agnostic domain code. No `vscode`, no `better-sqlite3`, no browser APIs.

- `types/` — `PaperRecord`, `Annotation`, `Collection`, `BatchImportResult`, `LogEntry`
- `events/` — `ExtensionEventBus`, `EVENTS` constant map
- `io/` — `PdfImportParser`, `BibTeXService`
- `db/` — `IResearchDatabase` interface, `InMemoryResearchDatabase`
- `interfaces/` — `IFileSystem`, `ILogger`

## `packages/vscode/src/`

The VS Code extension.

- `extension.ts` — entry point; wires all adapters and services
- `core/` — `PaperService`, `WorkspaceLogger`
- `db/` — `SqliteResearchDatabase` (`better-sqlite3` is only allowed here)
- `storage/` — `VsCodeFileSystem`, `LibraryPaths`, `WorkspacePaths`
- `ui/` — `CollectionsTreeDataProvider`, `ListWebviewPanel`, `SidebarWebviewProvider`
- `commands/` — `registerCommands`

## `packages/ai/`, `packages/latex/`, `packages/browser/`

Planned packages. Each has a `src/index.ts` stub and a `tsconfig.json` extending the root base config.

## `documents/`

Human-readable documentation, plans, specs, and architectural notes.

## `packages/vscode/__tests__/`

Automated tests organised by layer (core, db, storage, pdf, bibtex, commands).

## `test-workspace/`

Sample workspace used for manual extension-host verification.
