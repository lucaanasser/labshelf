# Plan: Reintroduce Import, Drag and Drop, and Batch in the Zotero-style UI

TL;DR — Reintroduce the ability to add papers in the new layout without abandoning the Zotero-style visual pattern already adopted: the sidebar remains the collections tree and the list remains in a dedicated tab, but both re-expose a clear import entry point. The plan covers manual import of PDFs and folders, drag and drop anywhere in the sidebar, and batch processing with each PDF handled individually.

## Objectives

- Re-expose a clear action for adding papers in the new UI.
- Allow manual selection of a single PDF or a local folder.
- Accept drag and drop of PDFs and folders anywhere in the sidebar.
- Process folders as a batch, expanding to PDFs and importing each file individually.
- Maintain the current visual pattern and extension architecture.

## Plan

1. Define the UX contract and commands for import.
   - The add action must appear in at least two places: the sidebar toolbar and the list toolbar.
   - Both entry points must trigger the same base import flow.
   - The manual picker must accept both PDF files and folders.
   - A folder selected in the picker must be treated as a batch of PDFs.

2. Reuse the current single-item import flow as the core.
   - `PaperService.addPaperFromUri` remains the main processing unit. Note that all possible metadata must be generated from the PDF, but the ingestion, persistence, and event flow is the same for a single PDF or for each PDF in a batch.
   - Parsing, persistence, artifact writing, and event emission must remain centralized.
   - The new batch logic must be built on top of that unit, not parallel to it.

3. Create a batch adapter on the back end.
   - The adapter must accept a list of `Uri`s and also a local folder.
   - When given a folder, it must expand it to the PDFs it contains.
   - The expansion must be recursive, with a strict `.pdf` filter.
   - Each PDF must be processed individually.
   - A failure for one item must not interrupt the others.
   - The batch result must distinguish total success, partial success, partial failure, and invalid inputs.

4. Define drag and drop as a global entry point in the sidebar.
   - Dropping PDFs and folders must work anywhere in the sidebar, not in a specific drop zone.
   - The sidebar must capture drag-over and drop events on the entire container.
   - There must be subtle visual feedback when the sidebar is in an active drop state.
   - The payload sent to the extension must allow distinguishing file, folder, and multiple items.

5. Implement the front-end flow without breaking the visual pattern.
   - The list and the sidebar must use the same visual language as the existing redesign.
   - The implementation must not reintroduce the old full sidebar webview as the primary surface.
   - If the current layout does not accommodate folder selection well, use a command, toolbar, or context menu — not a parallel panel with inconsistent visuals.
   - The drop interaction must be simple, clear, and predictable.

6. Implement the back-end flow for drag and drop.
   - Validate the received URIs.
   - Convert paths when necessary.
   - Ignore non-PDF inputs with structured logging.
   - Handle local files and folders.
   - Forward each PDF to the same import routine.
   - After each imported item, emit events to keep the sidebar and list in sync.

7. Update commands, contributions, and extension wiring.
   - Register commands for manual file import, manual folder import, drop import, and refresh.
   - Ensure the activation flow remains consistent with the current architecture.
   - Do not reintroduce the old full sidebar webview path.
   - Preserve the current model of TreeView for collections and WebviewPanel for the list.

8. Update specs to reflect the new behavior.
   - The sidebar spec must describe manual import, drop anywhere, and drag visual feedback.
   - The list spec must describe the same import contract and state update.
   - Create a new spec if needed to isolate the ingestion/import rules.
   - Specs must cover partial failures, invalid files, and folder batches.

9. Cover critical paths with automated tests.
   - Test importing a single PDF.
   - Test manual selection of a folder with multiple PDFs.
   - Test dropping a PDF anywhere in the sidebar.
   - Test dropping a folder.
   - Test rejection of non-PDFs.
   - Test partial batch with one failing item.
   - Test UI update when `PaperService` events are emitted.

10. Manually validate the final flow.
    - Open the Extension Development Host.
    - Confirm the add button is back.
    - Confirm the picker accepts both PDF and folder.
    - Confirm drop works outside a fixed drop zone.
    - Confirm a folder with multiple PDFs produces multiple items, each processed as an independent paper.

## Relevant files

- `/home/luca/labshelf/src/` — source root of the extension, useful for quick navigation between `core`, `commands`, `pdf`, `storage`, and `ui`
- `/home/luca/labshelf/src/core/` — domain and events layer; contains `paperService`, `eventBus`, `logger`, and shared types
- `/home/luca/labshelf/src/commands/` — extension commands and UI entry points for import and interface opening
- `/home/luca/labshelf/src/pdf/` — PDF parsing and normalization before persistence
- `/home/luca/labshelf/src/ui/` — TreeView, WebviewPanel, and HTML/CSS/JS for the Zotero-style experience
- `/home/luca/labshelf/src/storage/` — path, workspace, and filesystem utilities used by the ingestion flow
- `/home/luca/labshelf/documents/specs/` — functional specs that must reflect the UI and import contract
- `/home/luca/labshelf/__tests__/core/` — tests for the core data and events flow
- `/home/luca/labshelf/__tests__/commands/` — tests for commands exposed to the UI
- `/home/luca/labshelf/__tests__/ui/` — tests for providers and the visual panel

- `/home/luca/labshelf/src/core/paperService.ts` — core of single-item processing and the point for batch ingestion and per-item events
- `/home/luca/labshelf/src/pdf/pdfImportParser.ts` — per-PDF metadata parsing, used for each individual item
- `/home/luca/labshelf/src/commands/registerCommands.ts` — manual import commands and UI integration
- `/home/luca/labshelf/src/ui/listWebviewPanel.ts` — likely location to restore the add action, receive drops, and update visual state
- `/home/luca/labshelf/src/ui/collectionsTreeDataProvider.ts` — likely location to expose import actions in the sidebar without breaking the visual pattern
- `/home/luca/labshelf/src/ui/sidebarWebviewProvider.ts` and `/home/luca/labshelf/src/ui/sidebarHtml.ts` — reference for the old add, drop, and message contract
- `/home/luca/labshelf/src/extension.ts` — wiring between providers, commands, services, and events
- `/home/luca/labshelf/documents/ui-redesign.md` — reference for the layout and behavior that must remain consistent
- `/home/luca/labshelf/documents/specs/sidebar.spec.yaml` and `/home/luca/labshelf/documents/specs/list-panel.spec.yaml` — specs to update to reflect import, drop, and batch
- `/home/luca/labshelf/__tests__/ui/` and `/home/luca/labshelf/__tests__/core/` — UI and core tests to cover single import, batch, and errors

## Relevant symbols

- `PaperService.addPaperFromUri(sourceUri)` — base ingestion unit for one paper from a single PDF
- `PaperService.listPapers()` — data source for the list used by the UI to render the current library
- `PaperService.updatePaperStatus(paperId, status)` — status update that must continue triggering a UI refresh
- `PdfImportParser.parse(sourceUri)` — metadata extraction from the source PDF
- `registerCommands(context, paperService, logger)` — registration of commands used by toolbar, menu, and webview
- `SidebarWebviewProvider.handleMessage(message)` — old message contract, useful as a reference for drop and add
- `SidebarWebviewProvider.handleAddFromUri(rawUris)` — reference for the old URI-based ingestion flow
- `SidebarWebviewProvider.parseFileUri(raw)` — conversion of text payload to `vscode.Uri`
- `ListWebviewPanel` — class/entry point for creating and updating the list panel
- `CollectionsTreeDataProvider` — collections tree provider and likely location to expose import actions in the sidebar
- `ExtensionEventBus.emit(eventName, payload)` — event mechanism used to signal paper additions and updates
- `WorkspacePaths.papersRoot()` — base directory where imported PDFs are persisted
- `FileSystemService.ensureDirectory(targetFolder)` — safe directory creation during ingestion
- `BibTeXService.writePaperArtifacts(targetFolder, paper, sourcePath)` — bibliographic artifact generation after import

## Verification

1. Run focused tests for the modified slice before the full suite, prioritizing core and UI tests covering import and events.
2. Run `npm run compile` to ensure that the new command, provider, payload, and event contracts remain valid.
3. Validate in the Extension Development Host the manual single PDF path, a folder with multiple PDFs, and drop anywhere in the sidebar.
4. Confirm that specs and tests describe the same cases, including partial failures, invalid inputs, and event-driven updates.

## Decisions

- The main entry point must return without restoring the old full sidebar; the new UI remains a collections sidebar and a list tab.
- Batch must be processed file by file, with failure isolated per item and without interrupting the rest of the folder.
- Drag and drop must accept files and folders anywhere in the sidebar, but the actual processing unit is always the individual PDF.
- Do not include advanced deduplication, automatic collection organization, or external sync in this delivery unless they become necessary for import to work.

## Further Considerations

1. The manual picker can accept only PDF and folder at once, or separate them into distinct actions; the recommendation is to accept both in the same flow to reduce friction.
2. Folder expansion should be recursive with a strict `.pdf` filter, because this handles large batches without requiring extra configuration.
3. If the current design feels cramped, the best fallback is an add menu with clear options for file, folder, and drag and drop, maintaining a single back-end contract.
