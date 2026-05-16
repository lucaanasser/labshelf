# LabShelf Specs

This directory is organized by concern so the architecture can be read from the top down.

## Structure

- `core/` - domain orchestration, shared events, logging, and import flow
- `db/` - persistence contract and SQLite schema
- `io/` - PDF parsing and artifact generation
- `storage/` - library root, folder layout, and filesystem helpers
- `ui/` - tree view and list panel behavior
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
10. `commands/commands.spec.yaml`

## Notes

- `core/core-library.spec.yaml` documents the batch import flow currently owned by `PaperService`.
- `core/event-bus.spec.yaml` and `core/logger.spec.yaml` document the infrastructure used across the extension.
- `storage/storage.spec.yaml` covers `FileSystemService`, `LibraryPaths`, `LibraryLocation`, and the legacy `WorkspacePaths` alias.