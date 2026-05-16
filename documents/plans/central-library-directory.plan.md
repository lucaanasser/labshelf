# Plan: Central Library Outside the Workspace

## TL;DR

Implement a configurable central library mode set up on first use, persisted globally, so that LabShelf works with or without a folder open in VS Code. All papers are imported into a single user-chosen directory (e.g. `~/Research/LabShelfLibrary`) instead of depending on the current workspace.

## Objective

- Allow use of the extension without an open workspace.
- Centralize data/paper storage in a single directory configured by the user.
- Maintain the current import flow (single PDF, batch, drag and drop), changing only the path origin.
- Preserve existing fallback, structured logging, and events.

## Current State (Baseline)

1. The extension requires `workspaceFolder` to activate: [src/extension.ts](src/extension.ts#L23) and [src/extension.ts](src/extension.ts#L26).
2. Data paths depend on the workspace root via `WorkspacePaths`: [src/storage/workspacePaths.ts](src/storage/workspacePaths.ts#L8).
3. Paper import writes to `papers/<id>` inside the workspace: [src/core/paperService.ts](src/core/paperService.ts#L29).
4. SQLite index uses `.research/index.sqlite` in the workspace folder: [src/storage/workspacePaths.ts](src/storage/workspacePaths.ts#L24).
5. UI and commands are already decoupled from the physical path and consume `PaperService`, which makes the change easier: [src/commands/registerCommands.ts](src/commands/registerCommands.ts#L18), [src/ui/listWebviewPanel.ts](src/ui/listWebviewPanel.ts#L11), [src/ui/collectionsTreeDataProvider.ts](src/ui/collectionsTreeDataProvider.ts#L20).

## Expected Feature Outcome

1. On the first command that requires a library, if no directory is configured, open the wizard.
2. Wizard:
   - Select a base folder (`showOpenDialog`).
   - Enter the library name (`showInputBox`).
   - Create the final directory and required subdirectories (`.research`, `papers`, `.research/logs`).
3. Persist the configuration globally (not tied to a workspace).
4. Reuse that directory in any VS Code window (with or without an open folder).
5. If the path is invalid or inaccessible, guide reconfiguration without crashing.

## Proposed Architecture

### 1) New library configuration layer

- Add a dedicated module to resolve and persist the central library path.
- Responsibilities:
  1. Read the persisted configuration.
  2. Run initial setup when needed.
  3. Validate the directory's existence and minimum permissions.
  4. Expose the root URI to services.

Suggested new file:
- `src/storage/libraryLocation.ts` (resolver + setup + validation)

### 2) Evolving `WorkspacePaths` into a library path

- Option A (preferred): replace with `LibraryPaths` with a signature based on a `vscode.Uri` root.
- Option B: keep `WorkspacePaths` and remove the dependency on `WorkspaceFolder`, accepting an arbitrary root URI.

Direct impact:
- [src/storage/workspacePaths.ts](src/storage/workspacePaths.ts)
- [src/core/paperService.ts](src/core/paperService.ts#L20)
- [src/core/logger.ts](src/core/logger.ts)
- [src/extension.ts](src/extension.ts#L22)

### 3) Activation without a required workspace

- Remove the early return caused by absence of a workspace.
- During `activate`, resolve the central library:
  1. If configured and valid, initialize normally.
  2. If absent, initialize minimal state and trigger setup on the first write command (or immediate setup with confirmation).

Direct impact:
- [src/extension.ts](src/extension.ts)

### 4) Library guard for mutable commands

- Commands such as `labshelf.addPaper` must ensure the library is configured before importing.
- Read commands (`openPaper`, `searchLibrary`) must also check index availability.

Direct impact:
- [src/commands/registerCommands.ts](src/commands/registerCommands.ts)

### 5) Configuration persistence

Choose one storage option:
1. `context.globalState` (recommended for full extension control).
2. `labshelf.libraryRoot` in user-scope `settings.json`.

Criteria:
- Must work without a workspace.
- Must allow explicit update via a reconfiguration command.
- Must be easy to test and migrate.

## Affected Files and Functions (Complete Mapping)

### Entry point and service composition

- [src/extension.ts](src/extension.ts)
  1. `activate(context)`: currently requires workspace; must resolve central library instead.
  2. `initializeDatabase(indexPath, fileSystemService)`: unchanged, but `indexPath` will come from the central library.

### Paths and storage

- [src/storage/workspacePaths.ts](src/storage/workspacePaths.ts)
  1. `researchRoot()`
  2. `papersRoot()`
  3. `logsRoot()`
  4. `indexPath()`
  5. `appLogPath()`: all must stop depending on `WorkspaceFolder`.

- [src/storage/fileSystemService.ts](src/storage/fileSystemService.ts)
  1. `ensureDirectory(uri)`
  2. `writeText(uri, content)`
  3. `readText(uri)`: already supports arbitrary URIs; no structural change expected.

### Import core

- [src/core/paperService.ts](src/core/paperService.ts)
  1. `addPaperFromUri(sourceUri)` uses `paths.papersRoot()`.
  2. `addPapersFromUris(uris)` and recursive expansion remain valid.
  3. `deletePaper(paperId, deleteFiles)` maintains physical removal in the central library.
  4. `regenerateBibTeX()` maintains generation in each paper's directory.

### Database and logging

- [src/db/sqliteResearchDatabase.ts](src/db/sqliteResearchDatabase.ts)
  1. `initialize()` ensures the database directory is created.
  2. `upsertPaper`, `listPapers`, `deletePaper`, `appendLog` — no functional change.

- [src/core/logger.ts](src/core/logger.ts): writes logs to `app.log`; must receive paths from the new central root.

### UI and commands

- [src/commands/registerCommands.ts](src/commands/registerCommands.ts)
  1. `registerCommands(...)`: add library guard/setup before storage/db-dependent operations.

- [src/ui/collectionsTreeDataProvider.ts](src/ui/collectionsTreeDataProvider.ts): flow unchanged, but must show a friendly error if the library is unavailable.

- [src/ui/listWebviewPanel.ts](src/ui/listWebviewPanel.ts): actions (`addPaper`, `dropPapers`, `openPdf`) now depend on the same guard.

### Affected specs

- [documents/specs/core-library.spec.yaml](documents/specs/core-library.spec.yaml)
- [documents/specs/sidebar.spec.yaml](documents/specs/sidebar.spec.yaml)
- [documents/specs/commands.spec.yaml](documents/specs/commands.spec.yaml)
- [documents/specs/database.spec.yaml](documents/specs/database.spec.yaml)

Minimum spec updates:
1. `architecture.inputs` without workspace requirement.
2. `errors.expected_failures` with invalid/unconfigured central path.
3. `ui` including initial setup flow and reconfiguration command.
4. `tests` covering operation without a workspace.

### Related existing tests

- [__tests__/core/paperService.test.ts](__tests__/core/paperService.test.ts)
- [__tests__/commands/registerCommands.test.ts](__tests__/commands/registerCommands.test.ts)
- [__tests__/storage/fileSystemService.test.ts](__tests__/storage/fileSystemService.test.ts)
- [__tests__/db/database.test.ts](__tests__/db/database.test.ts)

Important note: there are signs of drift between old tests and current APIs (e.g. `registerCommands`, `FileSystemService`, `SqliteResearchDatabase` signatures). The delivery must include incremental test alignment by layer to avoid false coverage.

## Directories Involved

Source code:
- [src/core](src/core)
- [src/storage](src/storage)
- [src/db](src/db)
- [src/commands](src/commands)
- [src/ui](src/ui)

Specs:
- [documents/specs](documents/specs)

Tests:
- [__tests__/core](__tests__/core)
- [__tests__/commands](__tests__/commands)
- [__tests__/storage](__tests__/storage)
- [__tests__/db](__tests__/db)

Planning:
- [documents/plans](documents/plans)

## Implementation Plan (Phases)

1. Phase 1 — Central path infrastructure
   - Create central library resolver + global persistence.
   - Adapt the paths class to accept an arbitrary root.
   - Ensure the base directory structure is created.

2. Phase 2 — Activation and wiring
   - Remove workspace dependency from `activate`.
   - Initialize DB/logger/services with central paths.

3. Phase 3 — Configuration UX
   - Implement wizard on first use.
   - Add `labshelf.configureLibrary` command for reconfiguration.

4. Phase 4 — Robustness and errors
   - Clear messages for missing/invalid library.
   - Structured logs for setup, fallback, and access failures.

5. Phase 5 — Specs and tests
   - Update affected specs in the same change.
   - Create/adjust unit and integration tests for workspace-free mode.

## Proposed Functional Flow

1. User runs `labshelf.addPaper` without a configured library.
2. Extension opens the wizard (base folder + library name).
3. Extension creates the final directory and subdirectory structure.
4. Path is persisted globally.
5. Import continues normally to `papers/<id>/paper.pdf` in the central library.
6. In any future window, the extension reuses the same library.

## Proposed Error Contracts

1. Library not configured
   - Message: guide to setup.
   - Action: open wizard or cancel without mutating state.

2. Path no longer exists
   - Message: library unavailable; offer reconfiguration.
   - Log: `WARN` with saved path and context.

3. No write permission
   - Message: directory access failure.
   - Log: `ERROR` with stack/context.

4. SQLite failure
   - Current in-memory fallback behavior may be kept, but it must be explicitly communicated to the user that non-persistent mode is active.

## Acceptance Checklist

1. Extension activates without an open workspace.
2. First add triggers setup when necessary.
3. Central library is persisted across sessions.
4. Import works in any open folder/project.
5. Sidebar drag and drop continues to work.
6. `openPaperPdf` and `openPaperFolder` work with central paths.
7. Specs updated in the same change.
8. Tests updated and `npm test` passing.

## Out of Scope (This Delivery)

1. Multiple simultaneous libraries with a full switcher.
2. Cloud synchronization.
3. Automatic migration of old per-workspace libraries (may become a separate command later).

## Risks and Mitigations

1. Risk: breaking flows that assume a workspace.
   - Mitigation: encapsulate path resolution in a single layer and use a central guard.

2. Risk: regression in already-drifted legacy tests.
   - Mitigation: stabilize tests by layer starting from `core` and `commands`.

3. Risk: user configures an invalid folder.
   - Mitigation: immediate validation + reconfiguration command + actionable messages.
