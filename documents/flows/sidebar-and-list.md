# Sidebar and List Flow

## Sidebar

- The sidebar is a TreeView, not a full webview.
- It shows My Library, Recently Read, Unfiled Items, and custom collections.
- Clicking a collection opens the list panel.
- Toolbar actions create, refresh, rename, and delete collections.

## List panel

- The list panel is a reusable WebviewPanel.
- It shows the selected collection in the central editor area.
- The left side lists papers.
- The right side shows paper metadata and action buttons.
- Messages from the webview call existing commands or `PaperService` methods.
