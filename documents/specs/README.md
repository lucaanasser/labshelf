# LabShelf Specs

This directory is organized by concern so the architecture can be read from the top down.

## Structure

- `core/` - domain orchestration, shared events, logging, and import flow
- `db/` - persistence contract and SQLite schema
- `io/` - PDF parsing and artifact generation
- `storage/` - library root, folder layout, and filesystem helpers (paths/ + data/)
- `ui/` - tree view and list panel behavior
- `pdf-viewer/` - PDF webview viewer, themes, annotations, and HTML renderer
- `sync/` - multi-device sync subsystem and its provider-agnostic core engine
- `commands/` - command registration and command palette actions
- `ai/` - AI subsystem (foundation today; per-feature specs land with Phase 1 work)
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
14. `pdf-viewer/reader-webview.spec.yaml`
15. `ui/pdf-reader-navigation.spec.yaml`
16. `ui/pdf-reader-paper-resources.spec.yaml`
17. `sync/sync.spec.yaml`
18. `sync/sync-engine.spec.yaml`
19. `commands/commands.spec.yaml`
20. `ai/foundation.spec.yaml`

## Notes

- `core/core-library.spec.yaml` documents the batch import flow currently owned by `PaperService`.
- `core/event-bus.spec.yaml` and `core/logger.spec.yaml` document the infrastructure used across the extension.
- `storage/storage.spec.yaml` covers `fileSystemService` (root) plus the `paths/` (libraryPaths, libraryLocation, workspacePaths) and `data/` (paperDataStore, libraryIndexer, migrateSidecars) subdirectories, including the optional `reading` field in the sidecar and the per-paper write queue.
- `sync/sync.spec.yaml` describes the six-subdirectory layout; `sync/sync-engine.spec.yaml` details the provider-agnostic `sync/core/` engine.
- `pdf-viewer/renderer.spec.yaml` covers the trimmed HTML shell (post-overhaul); `pdf-viewer/reader-webview.spec.yaml` covers the bundled reader runtime (esbuild pipeline, module layout, protocol, handshake, canvas caps).
- `ui/pdf-viewer-basic.spec.yaml` now covers only the host-side `PdfViewerPanel`. All visible reader chrome is documented in `ui/pdf-reader-navigation.spec.yaml`, and the paper-aware features (copy with citation, export annotations, hover previews, external links) in `ui/pdf-reader-paper-resources.spec.yaml`.
- `ui/pdf-viewer-themes.spec.yaml` reflects the single source of theme presets in `pdf-viewer/shared/themePresets.ts` and the theme popover that now hosts the custom colour pickers. `ThemeManager.generateThemeCss` is gone.