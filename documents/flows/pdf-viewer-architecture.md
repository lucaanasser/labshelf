# PDF Reader — Architecture and Flows

This document describes the LabShelf PDF reader as it exists today,
after the immersive-navigation and paper-resources overhaul. All
paths are relative to `packages/vscode/`.

## 1. Layer diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ Extension host (Node)                                            │
│                                                                  │
│   src/extension.ts                                               │
│     ├─ registers labshelf.openPdfViewer (paperId?, page?)        │
│     ├─ registers labshelf.openPaperPdf / openPaper /             │
│     │  searchLibrary (all delegate to labshelf.openPdfViewer)    │
│     ├─ registers labshelf.openPaperPdfExternal (vscode.open)     │
│     ├─ registers labshelf.exportAnnotations                      │
│     └─ registers labshelf.reader.<id> command handlers           │
│                                                                  │
│   src/pdf-viewer/                                                │
│     ├─ PdfViewerPanel.ts                                         │
│     │    createOrShow(deps, paper, options?) → panel             │
│     │    static activePanel + postToActive(id)                   │
│     │    static exportAnnotations(am, paper, target)             │
│     │    dispatches WebviewToHost messages via                   │
│     │    isWebviewMessage                                        │
│     ├─ renderer/PdfRenderer.ts (HTML shell only)                 │
│     ├─ readerPrefs.ts (getReaderPrefs, getReaderViewColumn)      │
│     ├─ ThemeManager.ts (VS Code kind → PdfTheme; sidecar)        │
│     ├─ AnnotationManager.ts (CRUD + events; sidecar-backed)      │
│     └─ shared/                                                   │
│          protocol.ts (typed messages, ReaderBootParams,          │
│                       isWebviewMessage, isSafeExternalUrl)       │
│          readingState.ts (ReadingState, normalizeReadingState,   │
│                           clampPage)                             │
│          themePresets.ts (page pixel colours per theme)          │
│          citationFormat.ts (formatQuoteWithCitation, cleanQuote) │
│          annotationsMarkdown.ts (formatAnnotationsMarkdown)      │
│                                                                  │
│   src/storage/data/paperDataStore.ts                             │
│     PaperData sidecar { annotations, theme, reading? }           │
│     per-paper Promise queue serializes all mutators              │
│     getReadingState / setReadingState / addAnnotation / …        │
└──────────────────────────────────────────────────────────────────┘
                             │  webview.html + postMessage
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Webview (Chromium 122)                                           │
│                                                                  │
│   dist/reader/reader.js                                          │
│                                                                  │
│   src/pdf-viewer/webview/main.ts (entry)                         │
│     parses <script id="labshelf-boot" type="application/json">   │
│     posts { command: "ready-for-init" }                          │
│     awaits pdf.js, wires toolbar / sidebar / find /              │
│     status pill / hover previews / selection bubble              │
│                                                                  │
│   src/pdf-viewer/webview/ui/*  (DOM-touching, esbuild-only)      │
│     hostBridge, pdfLoader, viewerSetup, theme, themePopover      │
│     toolbar, sidebar, thumbnailsTab, outlineTab,                 │
│     annotationsTab                                               │
│     findBar, statusPill, zoomController, navHistory              │
│     keyboard, cheatsheet, selectionBubble                        │
│     hoverPreview, destPreview, citationResolver                  │
│     readingStateReporter, focusGuard, popover, dom, icons        │
│                                                                  │
│   src/pdf-viewer/webview/logic/*  (pure, jest-tested)            │
│     keymap  zoomMath  historyStack  debounce  autohide           │
│     outlineModel  destGeometry  textLines  referenceList         │
│     citationMarkers  findScroll  actionDedupe                    │
│                                                                  │
│   pdf.js (dynamic import from webview URIs)                      │
│     pdfjsLib          — pdfjs-dist/legacy/build/pdf.min.mjs      │
│     pdf_viewer.mjs    — PDFViewer + PDFLinkService +             │
│                         PDFFindController + EventBus             │
│     worker            — Blob URL built in the webview page       │
└──────────────────────────────────────────────────────────────────┘
```

- `src/pdf-viewer/webview/ui/**` and `src/pdf-viewer/webview/main.ts`
  are excluded from `packages/vscode/tsconfig.json` and from
  `jest.config.js` collectCoverageFrom. Only esbuild compiles them.
- `src/pdf-viewer/webview/logic/**` and `src/pdf-viewer/shared/**`
  are DOM-free, compile in both TypeScript programs (host and
  webview), and are jest-tested under the node environment.

## 2. Build pipeline

- Host: `pnpm --filter @labshelf/vscode build:host` →
  `tsc -p ./` → `out/**` (extension entry point).
- Webview: `pnpm --filter @labshelf/vscode build:webview` →
  `node build/reader.mjs` → esbuild bundle at
  `packages/vscode/dist/reader/reader.js` + `reader.css`.
  - Entry: `src/pdf-viewer/webview/main.ts`.
  - Options: `bundle`, `format: esm`, `platform: browser`,
    `target: ["chrome122"]`,
    `external: ["pdfjs-dist","pdfjs-dist/*"]`.
  - `--watch` (esbuild context), `--production` (minify + no
    sourcemap). Sourcemap inline in dev.
  - tsconfig: `src/pdf-viewer/webview/tsconfig.json` (lib
    `["ES2022","DOM","DOM.Iterable"]`, moduleResolution
    `Bundler`, `noEmit`).
- Combined: `pnpm --filter @labshelf/vscode build` runs the host
  build and then the webview build.
- Type-check: `pnpm --filter @labshelf/vscode typecheck` runs both
  programs (`tsc --noEmit -p ./` + `tsc --noEmit -p
  src/pdf-viewer/webview/tsconfig.json`).
- Development: `pnpm --filter @labshelf/vscode watch` runs the host
  compiler in watch mode; `watch:webview` runs esbuild in watch
  mode. Both are usually needed together.
- Missing bundle: when `dist/reader/reader.js` is absent
  (`resolveReaderBundleUris` returns null), `PdfRenderer.generateHtml`
  emits a static "Reader bundle not built" HTML page (no script,
  minimal CSP) instead of a blank webview.

## 3. Open flow

```
User invokes labshelf.openPaperPdf / openPaper / searchLibrary
  → registerCommands runs resolvePaper (id or picker)
  → vscode.commands.executeCommand("labshelf.openPdfViewer",
                                   paperId[, page])

labshelf.openPdfViewer (extension.ts)
  → resolvePaper again (id lookup or picker)
  → PdfViewerPanel.createOrShow(deps, paper, {page?})

PdfViewerPanel.createOrShow
  ├─ if a panel already exists for paper.id: reveal it and post
  │  { type: "scrollToPage", pageNumber: options.page } when
  │  supplied
  └─ else:
       - vscode.window.createWebviewPanel("labshelfPdf", …,
           getReaderViewColumn(), {
             enableScripts: true,
             retainContextWhenHidden: true,
             localResourceRoots: [
               getReaderBundleDirectory(extensionUri),
               vscode.Uri.file(paper.path),
               getPdfjsDirectory(),
             ],
             // enableFindWidget deliberately unset
           })
       - webview.onDidReceiveMessage → _handleMessage
       - onDidChangeViewState → tracks static activePanel + dwell
       - onDidDispose → close-out (guarded by _closed) →
         reading_events "close", PDF_VIEWER_CLOSED, dispose()
       - webview.html = PdfRenderer.generateHtml({
           webview, extensionUri, pdfUri, paperId, paperTitle,
           themeManager, themePreference: "auto",
           prefs: getReaderPrefs(),
         })
       - emit PDF_VIEWER_OPENED

PdfRenderer.generateHtml
  - resolveReaderBundleUris; if null → bundle-missing shell
  - resolvePdfjsUris (legacy → non-legacy fallback)
  - build ReaderBootParams: assets URLs, paperId, paperTitle,
    themePreference + effectiveTheme, prefs, isMac
  - CSP unchanged from the previous shell
  - <link rel="modulepreload"> pdfjs, pdf_viewer.mjs, reader.js
  - <link rel="preload"> pdf.worker.min.mjs and paper.pdf
  - <link rel="stylesheet"> pdf_viewer.css, reader.css
  - <script id="labshelf-boot" type="application/json"> with
    serializeBoot(boot) — every `<` becomes < so a title
    containing "</script>" cannot break out
  - <script type="module" nonce="…" src="…dist/reader/reader.js">

Webview boot (main.ts)
  1. installPolyfills()
  2. parse the labshelf-boot JSON block → ReaderBootParams
  3. new HostBridge()
  4. host.post({ command: "ready-for-init" })       ← t=0
  5. ThemeController(container, themePreference,
                     effectiveTheme)
  6. loadPdf(assets, perf):
       - fetch(pdfUrl) and fetch(workerUrl) in parallel
       - import(pdfjsUrl)
       - globalThis.pdfjsLib = pdfjsLib
       - build a Blob URL for the worker source and set
         pdfjsLib.GlobalWorkerOptions.workerPort
       - import(viewerUrl)
       - pdfjsLib.getDocument({
           data: pdfBytes, useWorkerFetch: false,
           cMapPacked: true, useSystemFonts: true,
           isEvalSupported: true, enableHWA: true,
           cMapUrl, standardFontDataUrl, wasmUrl, iccUrl (if set)
         }).promise → PDFDocumentProxy
  7. createViewer(): EventBus + PDFLinkService(ignoreDestinationZoom:
     true) + ReaderFindController (a subclass of PDFFindController
     that overrides scrollMatchIntoView; see section 8b) + PDFViewer
     (canvas caps: 2**25, capCanvasAreaFactor 200, maxCanvasDim 32767,
     enableDetailCanvas, initial pageColors from the effective theme)
  8. wire ZoomController, NavHistory, ThumbnailsTab, OutlineTab,
     AnnotationsTab, Sidebar, FindBar, Cheatsheet, StatusPill,
     SelectionBubble, ReadingStateReporter, Toolbar
  9. Keyboard, external-link capture-phase interceptor on #viewer,
     "click" on labshelf-boot → dispatch reader actions

Host receives ready-for-init → PdfViewerPanel._sendInit
  - Promise.all of themeManager.getThemeForPaper,
    annotationManager.getAnnotationsByPaper, readingStore?.getReadingState
  - host.post({ type: "init", reading, annotations, prefs, theme,
                effectiveTheme })

Webview receives init
  - buffered until pagesinit
  - on pagesinit:
      * pdfViewer.currentScaleValue = prefs.defaultZoom
      * container.scrollTop = 0  (pdf.js aligns page one with the
        container top, i.e. underneath the overlay toolbar; this
        puts page one below it — with or without a stored position)
      * host.post({ command: "ready", totalPages })
      * apply theme + annotations
      * if restorePosition && reading:
          pdfViewer.currentScaleValue = reading.scaleValue
          scrollPageIntoView with the XYZ destArray when top is set
          sidebar.restore(reading.sidebar) if present
      * ReadingStateReporter.start()
      * request an idle callback → construct HoverPreview,
        CitationResolver, DestPreview
```

Main.ts also calls `installTextLayerFocusGuard()` before anything
else. That guard wraps `HTMLElement.prototype.focus` so any element
with class `textLayer` is focused with `preventScroll: true`.
Reason: after a link is followed, `PDFLinkService` focuses the
destination page's text layer once it renders. If the reader has
already pressed Back by then ("peek at a reference and return"),
that late focus would drag them back to the destination, and even
when they stayed it could nudge the precise XYZ position. The
focus itself is kept for assistive technology.

## 4. Message protocol

See `src/pdf-viewer/shared/protocol.ts` for the exhaustive types
(`HostToWebview`, `WebviewToHost`, discriminants `type` and
`command`, `PROTOCOL_VERSION` and `ReaderBootParams`,
`isWebviewMessage`, `isSafeExternalUrl`).

### webview → host

| command | payload | host action |
|---|---|---|
| `ready-for-init` | — | `_sendInit()` → post `init` |
| `ready` | `{ totalPages }` | start dwell timer; if `OpenOptions.page` is set, post `scrollToPage`; emit `open` reading_event |
| `perf` | `{ timeline, pageNumber, theme, dpr, canvas }` | log INFO with the open timeline |
| `pageChanged` | `{ pageNumber }` | record page-dwell if >= 5000 ms and visible, update `_currentPage` |
| `zoomChanged` | `{ zoomLevel }` | accepted from older bundles; ignored (superseded by `saveReadingState`) |
| `selectTheme` | `{ theme }` | validate, persist through ThemeManager, echo `applyTheme` |
| `createAnnotation` | `{ type, pageNumber, content, color?, position? }` | AnnotationManager.createHighlight/createNote + reading_event "annotate" + `updateAnnotations` echo |
| `deleteAnnotation` | `{ id }` | AnnotationManager.deleteAnnotation + `updateAnnotations` echo |
| `updateAnnotation` | `{ id, content }` | AnnotationManager.updateAnnotation + `updateAnnotations` echo |
| `saveReadingState` | `{ state: ReadingState }` | normalize + `PaperDataStore.setReadingState` (queued) |
| `copyWithCitation` | `{ text, pageNumber }` | `formatQuoteWithCitation` + `env.clipboard.writeText` + status message |
| `copyText` | `{ text }` | `env.clipboard.writeText` + status message |
| `exportAnnotations` | `{ target: clipboard \| file }` | `formatAnnotationsMarkdown` → clipboard or `showSaveDialog` + `workspace.fs.writeFile` + open the file beside |
| `openExternalLink` | `{ url }` | `isSafeExternalUrl` (http/https/mailto only) → `env.openExternal`; other schemes are dropped + logged |

Malformed messages are rejected by `isWebviewMessage` and logged
`WARN` before the dispatcher runs.

### host → webview

| type | payload | webview action |
|---|---|---|
| `init` | `{ reading, annotations, prefs, theme, effectiveTheme }` | buffered; applied on pagesinit |
| `applyTheme` | `{ theme, effectiveTheme }` | ThemeController.apply |
| `updateAnnotations` | `{ annotations }` | AnnotationsTab.setAnnotations |
| `scrollToPage` | `{ pageNumber }` | goToPage (records history) |
| `prefsChanged` | `{ prefs }` | reassign ctx.prefs, toolbar.setAutoHide, close hover if disabled |
| `command` | `{ id: ReaderCommandId }` | `Keyboard.dispatch(id, 'host')` — cross-source dedupe drops only the same action arriving through the other source within CROSS_SOURCE_WINDOW_MS (250 ms) |

## 5. Reading-state persistence and the write queue

- The webview reports `updateviewarea` into
  `ReadingStateReporter`, which trailing-debounces the save at
  `SAVE_DEBOUNCE_MS = 800` and posts
  `{ command: "saveReadingState", state }`. The `scaleValue` stored
  is a preset string when the viewer is on one (page-width /
  page-fit / page-actual / auto), and `String(currentScale)`
  otherwise, so window resizes still refit for presets while a
  numeric zoom is preserved exactly.
- Flush on `visibilitychange` (`document.hidden`) and `pagehide`
  so a close never loses the last save.
- `PaperDataStore.setReadingState` shares the per-paper
  `Map<paperId, Promise>` queue with every other mutator (annotation
  create/update/delete, theme save). Two writes for the same
  `paperId` never interleave; a rejected task does not poison the
  queue; writes for different `paperId`s may run concurrently. Files
  are `.research/papers/<id>/data.json`.
- The `reading` field is optional in `PaperData` and is only
  serialized when set (see the save() helper's exact-optional
  guard). Legacy sidecars without a `reading` field load unchanged.
- Restore happens on `pagesinit` when `prefs.restorePosition` is
  true. `clampPage` bounds the stored page to `[1, totalPages]`.

## 6. reading_events

`PdfViewerPanel` calls `deps.onReadingEvent`
(`aiService?.recordReadingEvent`) with events:

- `open` on the reader's `ready` reply
- `close` on dispose (once, guarded by `_closed`)
- `scroll` when a page changes and the previous page's dwell was
  at least `MIN_DWELL_MS = 5000` ms while the panel was visible
- `annotate` on every successful `createAnnotation`

Background time is subtracted: when the panel hides, `_recordDwell`
runs and `_pageEnteredAt` is reset on visible.

## 7. Keyboard path

```
User presses a chord in the reader
  ├─ contributed keybinding fires (VS Code delivers it because
  │   `activeWebviewPanelId == 'labshelfPdf'`)
  │      → labshelf.reader.<id> handler runs
  │      → PdfViewerPanel.postToActive(id)
  │      → { type: "command", id } posted to the focused reader
  │      → main.ts host.on("command") → keyboard.dispatch(id, 'host')
  │      → logic/actionDedupe.isDuplicateDelivery drops this
  │        delivery only if the same action already ran from the
  │        OTHER source (source: 'key') within
  │        CROSS_SOURCE_WINDOW_MS (250 ms)
  └─ webview's own keydown fires
        → resolveKey(input, ctx) in webview/logic/keymap.ts
        → conventional table first (mod, function keys, Escape);
          vim layer only when labshelf.reader.vimKeys is true AND
          input is bare AND not inside a text input
        → keyboard.dispatch(action, 'key')
        → same cross-source dedupe rule; same-source repeats
          (held keys, repeated palette commands) always run
        → main.ts run(action) fires the corresponding controller
```

Contributed keybindings (unconditional, palette hidden unless a
reader panel is focused):

- `labshelf.reader.zoomIn` — Ctrl/Cmd+= and Ctrl/Cmd+Shift+=
- `labshelf.reader.zoomOut` — Ctrl/Cmd+-
- `labshelf.reader.zoomReset` — Ctrl/Cmd+0
- `labshelf.reader.find` — Ctrl/Cmd+F
- `labshelf.reader.historyBack` — Alt+Left (mac: also Cmd+[)
- `labshelf.reader.historyForward` — Alt+Right (mac: also Cmd+])
- `labshelf.reader.toggleSidebar` — F4 (not Ctrl/Cmd+B, which VS
  Code already owns for its own primary sidebar)

Notable in-webview bindings: Ctrl/Cmd+Alt+G opens the go-to-page
input (pdf.js convention); Ctrl/Cmd+G and Ctrl/Cmd+Shift+G are
find next / previous (F3 / Shift+F3 too); Ctrl/Cmd+Shift+C is
Copy with Citation; `?` opens the cheatsheet. Vim layer (opt-in
via `labshelf.reader.vimKeys`) adds j/k/h/l scrolling, J/K page
step, gg/G first/last page, `/` `n` `N` find, `H`/`L` history,
`+`/`-`/`w`/`e` zoom, `:` go-to-page, `t` toggle sidebar. The gg
chord expires after `CHORD_TIMEOUT_MS = 800` ms. Alt+letter chords
match on `KeyboardEvent.code` because macOS rewrites `key` for
Option+letter.

Inside `<input>`, `<textarea>` or `[contenteditable]` only
modified chords, function keys and Escape resolve. When the target
is a focused button/link/`[role=button]`/`[role=treeitem]`,
Space/Enter are left alone so the control activates natively.
When the target is inside `#sidebar` or a popover, scroll actions
fall through to native scrolling.

## 8. Toolbar auto-hide

`AutohideInputs` (see `webview/logic/autohide.ts`) carries an
optional `engaged` flag. It starts `false` and flips to `true` on
the first genuine user input:

- `wheel`, `touchmove` or `pointerdown` on `#viewerContainer`
- any `keydown` on `document`

While `engaged` is `false` the toolbar is pinned visible regardless
of scroll. This is what keeps the bar in view through pdf.js'
programmatic scrolls at open and restore (which would otherwise
hide it before the reader saw it). Combined with the
`container.scrollTop = 0` reset on `pagesinit`, this means:

- A paper opens with the toolbar visible whether or not a stored
  reading position was restored.
- Page one is placed below the overlay toolbar (pdf.js aligns it
  with the container's top edge, which is under the toolbar).
- The toolbar only starts auto-hiding after the reader's first
  manual scroll down.

The pinned condition is:
`!enabled || engaged === false || focusWithin || findOpen || menuOpen || scrollTop < TOP_REVEAL_PX (8) || (pointerY !== null && pointerY < POINTER_REVEAL_PX (48))`.

The status pill has three opacity states in `reader.css`:
`opacity: 0.55` by default, `0.3` while `documentElement` carries
`rd-chrome-hidden` (set by the toolbar when it hides), and `1` on
hover or focus-within (regardless of `rd-chrome-hidden`).

## 9. Find placement

`viewerSetup.ts` defines `ReaderFindController` inline, extending
pdf.js' public `PDFFindController`. It overrides
`scrollMatchIntoView(args)`. Nothing private is used.

The problem it solves: pdf.js runs a find step as two scrolls —
first the hit's page is aligned with the container's top via
`linkService.page`, then (once the page's text layer exists) the
hit itself is parked 50 px below the container top, which is
underneath the reader's overlay toolbar and find bar. pdf.js does
both scrolls even when the hit was already on screen.

Flow:

1. `FindBar.dispatch()` calls `ctx.markFindOrigin()` before each
   `find` event. That records `{ scrollTop, scrollLeft, at:
   performance.now() }` on the closure inside `createViewer`.
2. `ReaderFindController.scrollMatchIntoView(args)` runs pdf.js'
   implementation, then reads the hit rectangle relative to the
   container.
3. `logic/findScroll.freshOrigin` invalidates an origin older
   than `FIND_ORIGIN_TTL_MS = 3000` ms (a late text-layer render
   must not yank the reader back).
4. `logic/findScroll.decideMatchScroll`:
   - "stay" when the hit already sat inside the reading zone
     (`>= FIND_OVERLAY_PX = 110` px below the top and 64 px above
     the bottom of the container). The original `scrollTop` and
     `scrollLeft` are restored — the page does not move.
   - "place" otherwise. The hit is put at
     `max(FIND_OVERLAY_PX, Math.round(container.clientHeight * 0.3))`
     from the top — never under the find bar.

## 10. History freshness

`NavHistory.current()` (see `webview/ui/navHistory.ts`) calls the
public `pdfViewer.update()` before reading the cached
`updateviewarea` location. pdf.js refreshes that location one
animation frame after a scroll; two jumps within the same frame
(chord repeat, programmatic chain) would otherwise record the
first jump's departure point twice and lose the second.

## 11. Hover previews

- Delegated `mouseover` on `#viewer` for
  `section.linkAnnotation[data-internal-link]`.
- Open delay = `labshelf.reader.hoverDelayMs` (default 250,
  clamped `[0, 2000]`). `HoverPreview` tracks two anchors —
  `pendingAnchor` (open timer running) and `anchor` (popup open).
  Leaving either without entering the popup cancels the pending
  open or schedules a `CLOSE_GRACE_MS = 150` close; moving into
  the popup keeps it. Also closes on wheel/scroll of the viewer
  container, on the pdf.js `scalechanging` event, on keydown, and
  on mousedown outside the popup. Marker popups therefore close
  when the pointer leaves the text line.
- Link annotations are cached per page via
  `page.getAnnotations({ intent: "display" })` filtered by
  `subtype === "Link"`.
- Destination page = `getPageIndex(dest[0]) + 1` when `dest[0]`
  is a ref, or `dest[0]+1` when already an index. `destPoint`
  parses XYZ / FitH / FitBH / FitV / FitBV / FitR / Fit / FitB.
- Citation branch: `CitationResolver.isInReferences(pageNumber,
  y, x)` is true on the References page (below the heading in
  its column) and on every later page. `entryAt` returns the
  reference entry text at the destination; when it does, the
  popup shows the paragraphs plus Copy and Jump buttons.
- Fallback when entry boundaries are ambiguous or the heading is
  not found: the region preview (a cropped image of the
  destination page). The reader never shows a "Reference text
  unavailable" message; a picture is never wrong, extracted text
  could be.
- Region preview: `DestPreview.render(pageNumber, x, y)` renders
  the destination page offscreen at
  `(PREVIEW_CSS_WIDTH = 420 CSS px) * min(dpr, 2)`, caches up to 4
  page canvases (LRU), honours the current `theme.pageColors`, and
  crops to `cropRectForPreview` (`heightRatio 0.38`,
  `leadRatio 0.04`). The active `RenderTask` is cancelled when
  the popup closes.
- Plain-text markers (`[12]`, `[3, 7]`, `[4-6]`, en/em-dash
  variants) are only tried on pages with no link annotations.
  `citationMarkers.findCitationMarkers` returns the ranges;
  `markerAtOffset` picks the one under the pointer;
  `CitationResolver.entryNumbered(n)` looks up the entry. Up to
  `MAX_MARKER_ENTRIES = 3` entries are shown; extras become
  `+K more`.

## 12. External links

pdf.js keeps external `<a>` elements enabled in the DOM. The
reader installs a capture-phase click listener on `#viewer` that
intercepts anchor hrefs matching `/^(https?:|mailto:)/i`, calls
`preventDefault` and `stopPropagation`, and posts
`{ command: "openExternalLink", url }`. The host runs
`isSafeExternalUrl` again (defence in depth: `http:`, `https:`,
`mailto:` only) before `vscode.env.openExternal`. Other schemes
(`file:`, `command:`, `vscode:`, `javascript:`, `data:`) are
dropped and logged `WARN` with the paperId.

## 13. Rule: `logic/` vs `ui/`

- `src/pdf-viewer/webview/logic/**/*.ts` files **must not** import
  DOM globals, `vscode`, or pdfjs runtime values (only
  `import type` from `pdfjs-dist`). They are compiled by both
  TypeScript programs and by jest under the node environment.
- `src/pdf-viewer/webview/ui/**/*.ts` and
  `src/pdf-viewer/webview/main.ts` are DOM-touching. They are
  excluded from `packages/vscode/tsconfig.json` and from
  `jest.config.js` `collectCoverageFrom`. Only esbuild compiles
  them; the manual verification checklist exercises them at
  runtime.
- Every branching decision moves into `logic/*` so it is unit-
  testable without jsdom. `ui/*` files stay thin adapters that
  wire the pure logic into DOM events.

## 14. Reference

- Specs:
  `documents/specs/pdf-viewer/reader-webview.spec.yaml`,
  `documents/specs/pdf-viewer/renderer.spec.yaml`,
  `documents/specs/ui/pdf-reader-navigation.spec.yaml`,
  `documents/specs/ui/pdf-reader-paper-resources.spec.yaml`,
  `documents/specs/ui/pdf-viewer-basic.spec.yaml`,
  `documents/specs/ui/annotations.spec.yaml`,
  `documents/specs/ui/pdf-viewer-themes.spec.yaml`,
  `documents/specs/storage/storage.spec.yaml`,
  `documents/specs/extension.spec.yaml`.
- Source of truth for the keyboard table:
  `packages/vscode/src/pdf-viewer/webview/logic/keymap.ts` (a
  `cheatsheetRows` helper feeds the in-webview `?` overlay).
- pdfjs is pinned to `~6.3.289` in `package.json` because
  `webview/ui/theme.ts` reads the private `PDFViewer._pages` field
  to broadcast page-colour changes to already constructed
  `PDFPageView`s.
