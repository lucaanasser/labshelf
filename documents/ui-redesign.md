# LabShelf UI Redesign — Zotero-style Layout

## What was implemented

### Architecture change
The previous UI placed the full paper list inside the VS Code sidebar (a WebviewView). This was replaced with a **tree + tab** model inspired by Zotero:

- **Sidebar** → `CollectionsTreeDataProvider` (TreeView) showing a navigation tree of collections
- **Editor tab** → `ListWebviewPanel` (WebviewPanel) showing the detailed paper list with a details sidebar

The old `SidebarWebviewProvider` (full list in the sidebar) was removed from the extension activation. The code still exists in `src/ui/sidebarWebviewProvider.ts` and `src/ui/sidebarHtml.ts` as a reference.

### Collections sidebar (`src/ui/collectionsTreeDataProvider.ts`)
- Renders a tree with built-in virtual collections: **My Library** (all papers), **Recently Read** (reading/done status), **Unfiled Items** (all papers until collection membership is implemented)
- Shows paper count badges next to My Library and Recently Read
- Supports **user-created custom folders** persisted in `workspaceState` under the key `labshelf.customCollections`
- Refresh button and **New Collection** button in the view toolbar
- Context menu on custom collections: **Rename** and **Delete**
- Auto-refreshes counts on `paper:added`, `paper:updated`, `paper:deleted` events

### List panel (`src/ui/listWebviewPanel.ts`)
- Opens as a standard VS Code editor tab (singleton, reused across collection switches)
- **Left pane**: collapsible paper list
  - Column headers: Title | Creator | Status | Attachments
  - Each row has an expand toggle; expanding reveals child rows (PDF attachment)
  - Clicking a row selects it and populates the right panel
- **Right panel** (details sidebar, 272 px wide):
  - Paper title header
  - **Info** section: authors, year, cite key, status badge
  - **Abstract** section: summary text or placeholder
  - **1 Attachment**: link to `paper.pdf` → opens in VS Code
  - **Notes**, **Tags**, **Related**: collapsed placeholders (not yet backed by data)
  - **Action row**: Open PDF, Copy Key, Show Folder
  - **Status toggle**: Unread / Reading / Done (calls `PaperService.updatePaperStatus`)
- Reloads on `paper:added`, `paper:updated`, `paper:deleted` events
- Uses VS Code theme tokens throughout for light/dark/high-contrast compatibility

### New commands registered
| Command | Description |
|---|---|
| `labshelf.openListTab` | Open/reveal the list panel for a collection |
| `labshelf.newCollection` | Prompt for a name and create a custom collection |
| `labshelf.collections.refresh` | Force-refresh the tree |
| `labshelf.renameCollection` | Rename a custom collection (context menu) |
| `labshelf.deleteCollection` | Delete a custom collection with confirmation |

### Specs updated/created
- `documents/specs/sidebar.spec.yaml` — updated to describe the new tree-only sidebar
- `documents/specs/list-panel.spec.yaml` — new spec for the Zotero-style list panel

---

## What is still missing / future work

| Feature | Notes |
|---|---|
| Paper-to-collection assignment | Papers can't yet be added to custom folders; the Unfiled collection shows all papers as a workaround |
| Notes | `notes` table exists in SQLite schema but no UI or service to create/read them |
| Tags | `paper_tags` and `tags` tables exist but no UI |
| Related papers | `citations` table exists but no UI |
| Search / filter in list panel | No in-panel search; command-palette search still works |
| Drag-and-drop PDF import | Was in the old sidebar; not yet ported to the new tree/tab model |
| DOI / arXiv / ISBN lookup | Mock in the old sidebar; not yet surfaced in the new UI |
| Sortable columns | Column headers are decorative; no sort logic yet |
| Pagination / virtualisation | The entire paper list is rendered at once |
| Last-read timestamp | The "Recently Read" filter uses `status` as a proxy; no actual timestamp field |
