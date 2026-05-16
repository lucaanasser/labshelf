# LabShelf Specs

This directory is organized by concern so the architecture can be read from the top down.

## Structure

- `core/` - domain orchestration, shared events, logging, and import flow
- `db/` - persistence contract and SQLite schema
- `io/` - PDF parsing and artifact generation
- `storage/` - library root, folder layout, and filesystem helpers (paths/ + data/)
- `ui/` - tree view, list panel, and sync tree behavior
- `pdf-viewer/` - PDF webview viewer, themes, annotations, and HTML renderer
- `sync/` - multi-device sync subsystem and its provider-agnostic core engine
- `commands/` - command registration and command palette actions
- `extension.spec.yaml` - bootstrap and wiring for the whole extension

## Reading order

1. `extension.spec.yaml`
2. `core/paper-service.spec.yaml`
3. `storage/storage.spec.yaml`
4. `db/database.spec.yaml`
5. `db/sqlite-schema.spec.yaml`
6. `io/pdf.spec.yaml`
7. `io/bibtex.spec.yaml`
8. `ui/sidebar.spec.yaml`
9. `ui/list-panel.spec.yaml`
10. `ui/pdf-viewer-basic.spec.yaml`
11. `ui/annotations.spec.yaml`
12. `ui/pdf-viewer-themes.spec.yaml`
13. `pdf-viewer/renderer.spec.yaml`
14. `sync/sync.spec.yaml`
15. `sync/sync-engine.spec.yaml`
16. `commands/commands.spec.yaml`

## Notes

- `core/core-library.spec.yaml` documents the batch import flow currently owned by `PaperService`.
- `core/event-bus.spec.yaml` and `core/logger.spec.yaml` document the infrastructure used across the extension.
- `storage/storage.spec.yaml` covers `fileSystemService` (root) plus the `paths/` (libraryPaths, libraryLocation, workspacePaths) and `data/` (paperDataStore, libraryIndexer, migrateSidecars) subdirectories.
- `sync/sync.spec.yaml` describes the six-subdirectory layout; `sync/sync-engine.spec.yaml` details the provider-agnostic `sync/core/` engine.
- `pdf-viewer/renderer.spec.yaml` covers the `pdf-viewer/renderer/` HTML generation submodule (`PdfRenderer`, `template.css`, `template.js`).