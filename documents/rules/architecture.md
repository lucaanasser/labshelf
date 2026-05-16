# Architecture Rules

These are the rules that keep LabShelf easy to change.

## Layering

- `packages/core` must not import `vscode`, `better-sqlite3`, or browser APIs.
- `packages/vscode/src/db/` is the only place `better-sqlite3` is allowed.
- Do not let UI code reach into the database directly when a service already exists.
- Do not put file access, database access, and UI rendering in the same flow unless there is no suitable abstraction.

## Ownership

- `PaperService` owns import, update, delete, and BibTeX regeneration for papers.
- `PdfImportParser` owns metadata extraction from source PDFs. It accepts `IFileSystem`, not `vscode.workspace.fs`.
- `WorkspacePaths` owns workspace-local path resolution.
- `VsCodeFileSystem` owns filesystem mutations in the VS Code package. It implements `IFileSystem`.
- `ExtensionEventBus` owns propagation of domain events.
- UI providers own presentation, not persistence.

## Dependency injection

- Every service in `packages/core` receives its platform dependencies via constructor (no singletons, no ambient globals).
- The composition root is `packages/vscode/src/extension.ts`. It is the only place that instantiates concrete adapters.

## Change discipline

- If a feature changes behavior, update the corresponding `specs/*.spec.yaml` file.
- If a new UI surface is added, document the flow in `flows/` and the owning module in `reference/`.
- Prefer small services with one responsibility.
- Preserve the existing event-driven flow instead of inventing a parallel path.
