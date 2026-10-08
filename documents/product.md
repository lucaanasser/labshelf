# Product

LabShelf is a local-first manager for research papers. The library is an ordinary folder of PDFs and text files that the user owns; every app reads and writes that same format, and Google Drive sync is optional.

LabShelf ships as three apps of one product:

| App | Where it runs | What it is for |
|---|---|---|
| VS Code extension | VS Code | the full workspace: library, reader, import with OCR, AI indexing |
| Browser extension | Chrome, Firefox | capture papers from the web, read and annotate them, browse the library without VS Code |
| Terminal app (`labshelf`) | any terminal | a keyboard-driven explorer and scriptable CLI over the same library |

The website that presents LabShelf is not one of these apps. It explains the product and links to the three apps.

## One product, three surfaces

When a user moves from one app to another, it should feel like the same product:

- **Same look.** Colours, type, spacing, icons and components come from the design system in core (see [architecture.md](architecture.md#design-system)). The VS Code extension and the browser extension share those components. The terminal maps the same colour tokens onto its palette.
- **Same words.** A folder is a "folder" and a paper is a "paper" in every app. The reading statuses are Unread, Reading and Done.
- **Same behaviour.** A feature that exists in two apps behaves the same in both, because its logic lives once in core. Examples are search and filters, citation formats, metadata lookup, and the reader with its keys.
- **Same data.** A paper added, read or annotated in one app shows up in the others: locally through the shared folder, remotely through Drive ([contracts/sync.md](contracts/sync.md)).

## UX principles

1. **Paper-first, not a file explorer.** Zotero is the reference. Folders are for navigation and papers are the content, so a list shows papers only and never mixes folder rows into it. Folder structure appears as a path header, chips or a separate pane. Avoid file-manager idioms such as an "up" button or Backspace to go to the parent folder.
2. **Fluid navigation over features.** Navigating never rebuilds a view. Selection, scroll position and search survive a folder change. State is pushed to an open view rather than the view being reloaded.
3. **Abstract first.** The detail pane leads with what helps decide whether to read: title, authors, venue, abstract, then actions.
4. **Keyboard everywhere.** Every action has a key. The reader offers optional vim keys, and the terminal follows yazi's columns and keys while keeping Zotero's pane model (folders | papers | preview).
5. **Never lose the user's work.** Sync never deletes a file because of something it cannot explain. When unsure, it keeps both copies. Destructive actions ask for confirmation.
6. **No emoji or Unicode glyphs as icons.** Icons are inline SVGs from the shared icon set. The terminal uses plain text or its own glyphs.
