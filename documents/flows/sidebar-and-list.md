# Sidebar and List Flow

## Sidebar

- The sidebar is a TreeView, not a full webview.
- The Library view shows an "All Papers" root plus the folders that exist on disk under `papers/`. There are no virtual or user-defined collections — the tree is a mirror of the directory structure, so reorganising it in the sidebar reorganises the real folders.
- Each row shows how many papers live under it.
- Clicking a row opens the list panel on that folder.
- Title-bar actions add a paper, create a folder at the library root, and refresh. Right-clicking a folder offers add-paper-here, new folder, rename, and delete.
- Folders can be dragged inside the tree, and PDFs can be dropped anywhere in it, which imports them into the folder they were dropped on.
- Below Library sit the Writing, Reading, Insights, Assist and Agents views. They are placeholder trees — visual scaffolding with no behavior yet.
- The Settings view is an empty tree whose welcome content links to the settings panel, which is where the Drive connection, sync interval and library location are managed.

## List panel

- The list panel is a reusable WebviewPanel, reused across folder switches rather than opened per folder.
- It shows the selected folder in the central editor area.
- The left side lists papers, with a search box and sortable Title, Creator, Year and Publication columns.
- The right side shows paper metadata and action buttons.
- Messages from the webview call existing commands or `PaperService` methods.
- When the panel navigates, the tree selection follows it; when a folder is renamed or moved, the open panel follows the change instead of going stale.
