# Contract: library format

A LabShelf library is a folder that the user owns. Every app reads and writes this format, and the sync engine moves it between devices. Changing a file name, a key or a serialization rule here changes the contract for every app and for libraries already on disk.

## Layout

```
<library root>/
  papers/                          visible, user-organised, synced (namespace "library")
    <folder>/<folder>/…            the user's folders, any depth
      <paper id>/                  one folder per paper; the folder name is the paper id
        paper.pdf                  optional
        metadata.yaml              required: a folder holding it is a paper
        bib.bib                    BibTeX entry generated from metadata.yaml
  .research/                       hidden, owned by the apps
    papers/<paper id>/data.json    the sidecar (synced, namespace "appdata")
    index.sqlite                   VS Code's index, a rebuildable cache (never synced)
    logs/app.log                   VS Code log (JSON lines)
    logs/terminal.log              terminal log (JSON lines)
    sync/google-drive.*            sync coordination (see sync.md, never synced)
```

The browser stores the same tree in IndexedDB under the same relative paths. `papers/…` maps to the `library` namespace, and `appdata/<paper id>/data.json` maps to `.research/papers/<paper id>/data.json`.

## Paper identity

- The paper id is the name of its folder and equals its cite key. It never changes when the paper moves between folders.
- A new id is generated from the paper's metadata and must not collide, case-insensitively, with an id already in the library.
- The sidecar is keyed by id, not by folder path, so moving a paper never orphans its annotations.

## metadata.yaml

`metadata.yaml` is the source of truth for a paper's record. Every index (SQLite, IndexedDB, the terminal's in-memory snapshot) is rebuilt from it.

| Key | Type | Notes |
|---|---|---|
| `title` | string | falls back to the id |
| `citekey` | string | falls back to the id |
| `path` | string | the paper folder as the writing app saw it; informational, apps locate papers by scanning |
| `source` | string | the file name the user imported |
| `authors` | string[] | |
| `year` | number | |
| `status` | `unread` \| `reading` \| `done` | anything else reads as `unread` |
| `summary` | string | the abstract |
| `journal`, `publisher`, `volume`, `issue`, `pages`, `doi`, `url`, `issn`, `language` | string | |
| `keywords` | string[] | from the paper or the metadata source |
| `tags` | string[] | the user's labels |
| `note` | string | the user's note |
| `textLayer` | `{state, ocrPages?, failedPages?, reason?}` | whether the PDF has selectable text |

Rules:

- Unknown keys are preserved on rewrite.
- `hasPdf` is never written. Each app derives it from the presence of `paper.pdf`.
- An app writes only the keys it owns in that action. A metadata refresh does not touch `status`, `tags` or `note` (see [sync.md](sync.md#coordination-between-local-apps)).
- `bib.bib` is regenerated whenever `metadata.yaml` is written. One core service writes both. Its `file` field points at `paper.pdf` only when that file exists.

## Sidecar: `data.json`

The sidecar holds per-paper state from the reader: annotations, the reader theme and the last reading position.

```json
{
  "annotations": [ { "id": "…", "paperId": "…", "type": "highlight", "pageNumber": 3,
                     "content": "…", "color": "yellow",
                     "position": { "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.02 },
                     "createdAt": "…", "updatedAt": "…" } ],
  "theme": "auto",
  "reading": { "page": 6, "scaleValue": "page-width", "left": 0, "top": 512,
               "sidebar": { "open": true, "tab": "outline", "width": 240 },
               "updatedAt": "…" }
}
```

- Every app writes the exact same bytes: this key order, two-space indent, and `reading` omitted until the paper is first opened. Two apps writing different bytes for the same state would cause sync conflicts.
- `theme` is one of `auto`, `light`, `dark`, `sepia`, `high-contrast`.
- An annotation `color` is one of `yellow`, `green`, `blue`, `red`, `pink`.
- `position` is normalised to the page: every value is in 0..1, width and height are positive, and the box stays inside the page.
- `scaleValue` is a pdf.js preset (`page-width`, `page-fit`, `page-actual`, `auto`) or a number in (0, 64] written as a string. `left` and `top` are in PDF points from the top-left of the page.
- Reading is defensive. A corrupt or hand-edited sidecar never throws: invalid fields fall back to their defaults, and annotations without an `id` are dropped.

## Shared configuration

`~/.config/labshelf/config.json` (respects `XDG_CONFIG_HOME`) points the local apps at the library:

```json
{ "version": 1, "libraryRoot": "/abs/path/to/library", "terminal": { … } }
```

The terminal resolves the library in this order: `--library`, then `LABSHELF_LIBRARY`, then `libraryRoot`. VS Code writes `libraryRoot` whenever a library is configured or opened, and falls back to it when it has none of its own. Every writer keeps the keys it does not own and writes atomically (temporary file, then rename).
