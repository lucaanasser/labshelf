# Browser Library Flow

End-to-end story for the standalone library page shipped in the LabShelf
browser extension. Mirrors the VSCode list panel but works offline on top of
IndexedDB and shares the Google Drive folder with the VSCode extension via the
sync engine in `@labshelf/core`.

## Surface

- Three columns: collections tree (left), paper list (middle), detail (right).
- Sticky header: title · breadcrumb · search input + [SYNC] + [+ ADD].
- Sticky footer: sync status pill (left) · paper count (right).

## Bootstrap

1. The user clicks "Open library" in the popup, which calls
   `bx.tabs.create({ url: bx.runtime.getURL("library-page/index.html") })`.
2. `library-page/index.ts` builds the layout (`buildApp`), creates the
   `LibraryStore`, and mounts each view subscribed to its slice.
3. `dataController.initLibraryData` runs in parallel:
   - `buildFolderTree("papers")` from `folderTreeStore`
   - `listByFolder("papers")` from `paperRecordStore`
   - `runtime.sendMessage({ type: "sync.status" })` for the footer pill
4. Views render. If the IDB is empty, every pane shows its empty-state copy.

## Browsing

- Selecting a folder in the tree publishes `selectedFolder`. The
  dataController subscriber re-runs `listByFolder` to refresh the papers slice.
- The breadcrumb tokenises the selected path and renders clickable crumbs.
- The search input updates `state.search`; the paper list view filters in
  place so the store keeps the raw folder slice intact.
- Clicking a paper publishes `selectedPaperId`; the detail pane re-renders.

## Folder CRUD

Tree view emits DOM CustomEvents — `labshelf:new-folder`,
`labshelf:rename-folder`, `labshelf:delete-folder`. `folderController` handles
each:

- **New** → prompt for a name, write `<parent>/<name>/.keep` to the IDB files
  store (folders are virtual; the sentinel makes them visible to
  `buildFolderTree`).
- **Rename** → `IndexedDbFileSystem.moveDir(old, new)` re-keys every file row
  under the old prefix, then `FolderService.relocatePapersUnder(old, new)`
  rewrites every PaperRecord whose path starts with the old prefix.
- **Delete** → `FolderService.removePapersUnder(path)` drops the records,
  then `IndexedDbFileSystem.deleteDir(path)` drops the files.

After every mutation, `refreshFolders` + `refreshPapersSlice` re-pull from
IDB so the views update without a sync round-trip.

## Paper actions

Detail pane emits `labshelf:paper-action` with `{ id, action }`.
`paperController` switches on action:

- **open-pdf** → reads `paper.pdf` bytes from IDB, wraps them in a
  `Blob({ type: "application/pdf" })`, and opens the Blob URL in a new tab.
- **copy-cite** → `navigator.clipboard.writeText(paper.citeKey)`.
- **status-reading / status-done** → upserts the record with the new status
  via `paperRecordStore`, then rewrites `metadata.yaml` + `<citeKey>.bib`
  through `BibTeXService` so the next sync uploads the change.
- **delete** → confirms with the user, then drops the record and the folder.

## Sync handshake

The library page does not push to Drive directly. The header `[SYNC]` button
sends `sync.now` to the background service worker, which runs the
`SyncEngine` from `@labshelf/core`. While `state.sync.syncing` is true the
`dataController` polls `sync.status` every 1.5s and refreshes folders +
papers when the sync settles, so newly-downloaded papers and new folders
appear in the panes automatically. The footer pill mirrors the sync state:
`▶ SYNCING`, `• DRIVE · SYNCED HH:MM:SS`, or `SYNC ERR · <message>`.

## What VSCode sees after a browser sync

Every mutation lands in the shared `LabShelf Library/` Drive folder used by
the VSCode extension. On the next VSCode sync the folder reappears with its
new name, the deleted papers vanish, and updated `metadata.yaml` files reflect
status changes. The manifest in Drive's `appDataFolder` is shared (Phase 4),
so the two clients agree on the merge base without re-downloading every file.
