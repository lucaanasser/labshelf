# PDF Viewer: Problems Found and Solutions Applied

Date: 2026-05-13  
Scope: Phases 1, 2, and 3 (basic viewer, annotations, and themes)

## 1. Executive Summary

During the PDF Viewer analysis, two main problems were identified:

1. Noticeable slowness when opening PDFs.
2. Theme not applied correctly to the PDF page content.

The fixes implemented resolved the root cause of both problems without breaking existing tests.

## 2. Problems Identified

### 2.1 Slow PDF opening

Observed symptom:
- The viewer took a long time to display the PDF when opening a paper.

Technical causes:
- The initialization flow waited for extra steps before delivering the first paint.
- The panel structure performed unnecessary work in theme-switching scenarios.
- There was a complete HTML rebuild of the webview in operations where incremental updates would have sufficed.

Impact:
- Opening time greater than expected for interactive use.
- Perceived slowness compared to readers such as Zotero and vscode-pdfviewer.

### 2.2 Theme not applied to PDF content

Observed symptom:
- Toolbar and container changed theme, but the PDF page remained visually unchanged.

Root cause:
- PDF content is rendered on canvas (pixels).
- Swapping CSS variables on the container does not alter the already-rasterized pixels on the canvas.
- The `applyTheme` handler was updating state but not applying an effective visual transformation to the canvas.

Impact:
- The themes feature appeared broken to the end user.
- Clear discrepancy between expected and actual behavior.

## 3. Solutions Implemented

### 3.1 Theme applied effectively to PDF content

What was done:
- Defined per-theme visual filter variables for the canvas.
- Applied the canvas filter in the webview stylesheet.
- Adjusted the script to apply the effective theme immediately upon receiving an `applyTheme` message.
- Sent theme preference and effective theme separately to support auto mode with correct synchronization.

Result:
- Light, Dark, Sepia, and High Contrast now affect the visible page content.
- Theme switching is instantaneous, without needing to reload the entire viewer.

### 3.2 Removal of full re-render on theme change

What was done:
- Replaced the strategy of rebuilding `webview.html` with updates via `postMessage`.
- In auto mode, VS Code theme changes now send only an effective theme update.

Result:
- Less processing overhead.
- Less state loss and less redundant work.
- Better responsiveness when switching themes.

### 3.3 Initial opening optimization

What was done:
- Initialization was changed to prioritize the viewer's first paint.
- Annotation loading was moved to an asynchronous step after the initial render.

Result:
- PDF appears on screen sooner.
- Sidebar and overlays are updated afterward without blocking the initial opening.

## 4. Validation Evidence

Validations performed:
- TypeScript compilation without errors.
- Focused PDF viewer tests with full pass.

Commands validated:
- npm run compile
- npm test -- pdf-viewer

Status:
- All test suites related to the viewer passed.

## 5. Comparison with Reference Readers

The behavior of the vscode-pdfviewer ecosystem (based on the full PDF.js viewer) was analyzed.

Relevant architectural points observed:
- Incremental rendering strategy.
- Render queue with priority for visible pages.
- State caching and reuse to avoid redundant work.
- `pageColors` support in the PDF.js rendering pipeline.

Conclusion:
- The performance gains in those readers come mainly from incremental architecture and caching, not just CSS.
- The fixes applied in this iteration align LabShelf's foundation with that approach.

## 6. Current Risks and Limitations

1. Using canvas filters resolves the visual experience quickly, but does not fully replace native PDF.js `pageColors` in all cases.
2. There is still room to speed up very large PDFs with more aggressive virtualization.
3. Rendering remains single-page-at-a-time in the current flow.

## 7. Recommended Next Improvements

### 7.1 Performance
- Implement per-scale page cache.
- Pre-render the next and previous pages.
- Virtualization for long documents.
- Additional debounce for intensive zoom/navigation events.

### 7.2 Theming
- Evolve from visual filters to a `pageColors`-based strategy where applicable.
- Expand visual tests for contrast and readability per theme.

### 7.3 Observability
- Add opening time metrics (ms to first paint).
- Structured logging for render operations and theme changes.

## 8. Conclusion

The main reported problems (slow opening and theme not applied) were traced to architectural and canvas rendering causes.

The delivered fixes:
- Eliminate unnecessary re-renders on theme change.
- Apply the theme visibly to PDF content.
- Reduce perceived opening time by prioritizing first paint.

With these changes, the viewer is functionally consistent with the proposal from phases 1 to 3 and closer to the expected experience in reference readers.
