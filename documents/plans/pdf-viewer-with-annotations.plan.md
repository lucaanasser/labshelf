# PDF Viewer with Annotations and LaTeX Integration

**Creation date**: May 2026  
**Status**: Planning  
**Priority**: High  

---

## 1. Overview

Implement an interactive PDF viewer inside LabShelf that:
- Replaces opening PDFs in an external application
- Works as a native webview panel in VS Code
- Synchronizes its theme with the VS Code theme (light/dark)
- Allows manual PDF theme customization in the navbar
- Supports annotations (highlights, notes, comments)
- Exports annotations and summaries in LaTeX format
- Integrates with the LaTeX Workshop extension for direct insertion into documents

---

## 2. Main Features

### 2.1 PDF Viewing
- ✅ Render full PDF via PDF.js
- ✅ Page-by-page navigation (first, last, next, previous, go to page)
- ✅ Zoom (presets: 50%, 75%, 100%, 125%, 150%, 200%)
- ✅ Text search within the PDF
- ✅ Display PDF outline/table of contents (if available)

### 2.2 Themes and Appearance
- ✅ Default theme synchronized with VS Code (dark/light/auto-detect)
- ✅ Navbar dropdown to change PDF theme independently
- ✅ Theme options:
  - `auto` (follows VS Code)
  - `light`
  - `dark`
  - `sepia` (warm tones)
  - `high-contrast` (for accessibility)
- ✅ Per-paper theme preference persisted in the database

### 2.3 Annotations
- ✅ **Highlights**: select text and highlight with colors (yellow, green, blue, pink, red)
- ✅ **Margin notes**: add free-floating text in the page margin
- ✅ **Comments**: associate long/structured text with a selection
- ✅ **Reference tags**: mark important passages with customizable tags
- ✅ View annotation list in a side panel
- ✅ Click an annotation in the list → navigate to page + highlight it

### 2.4 Export and LaTeX
- ✅ **Export summary**: generate a Markdown/LaTeX file with all notes + highlights + structure
- ✅ **Insert into LaTeX Workshop**: 
  - "Insert into document" button that opens a selector for open .tex files
  - Inserts a structured block with citation + notes
  - Example:
    ```latex
    % From: [citekey] - Title
    % Date: 2026-05-13
    
    \section*{Notes from \cite{[citekey]}}
    \begin{itemize}
      \item [highlight 1]
      \item [highlight 2]
    \end{itemize}
    ```
- ✅ **Create new LaTeX document**: generate a .tex file with a summary template based on the PDF
- ✅ **Export updated BibTeX**: include annotations as custom fields (annote, keywords)

### 2.5 LaTeX Workshop Integration
- ✅ Check if LaTeX Workshop is installed (no error if it is not)
- ✅ Offer "Insert into document" only if a .tex file is open
- ✅ Command palette: "LabShelf: Insert highlights from current PDF into LaTeX"
- ✅ Quick pick to select which .tex file to use as destination

### 2.6 Annotation Management
- ✅ Edit/delete existing annotations
- ✅ Search within a paper's annotations
- ✅ Synchronize annotations across multiple openings of the same paper
- ✅ Automatic backup of annotations in JSON or SQL file

---

## 3. Proposed Architecture

### 3.1 New Layers
```
src/
├── pdf-viewer/              (new)
│   ├── PdfViewerPanel.ts
│   ├── PdfRenderer.ts       (PDF.js control)
│   ├── AnnotationManager.ts (manage highlights + notes)
│   ├── ThemeManager.ts      (synchronize with VS Code)
│   └── index.ts
│
├── pdf-export/              (new)
│   ├── LatexExporter.ts     (generate LaTeX from annotations)
│   ├── MarkdownExporter.ts
│   └── BibTeXEnhancer.ts    (add custom fields)
│
├── latex-integration/       (new)
│   ├── LatexWorkshopBridge.ts (detect and communicate with LaTeX Workshop)
│   └── DocumentInserter.ts  (insert content into .tex files)
│
└── ui/
    ├── pdfViewerWebview/    (new)
    │   ├── pdfViewer.html
    │   ├── pdfViewer.css
    │   ├── pdfViewer.js     (webview logic)
    │   └── annotationUI.ts
```

### 3.2 Database (New Tables)
```sql
-- Annotations per paper
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  paperId TEXT NOT NULL,
  type TEXT NOT NULL,          -- 'highlight' | 'note' | 'comment' | 'tag'
  pageNumber INTEGER NOT NULL,
  content TEXT NOT NULL,       -- note text or highlight text
  color TEXT,                  -- for highlights: 'yellow', 'green', 'blue', etc.
  position JSON,               -- {x, y, width, height} for exact location
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE
);

-- Per-paper theme preferences
CREATE TABLE paperThemePreferences (
  paperId TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'auto', -- 'auto' | 'light' | 'dark' | 'sepia' | 'high-contrast'
  updatedAt DATETIME NOT NULL,
  FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE
);

-- Generated summary cache
CREATE TABLE generatedSummaries (
  id TEXT PRIMARY KEY,
  paperId TEXT NOT NULL,
  format TEXT NOT NULL,         -- 'latex' | 'markdown' | 'bibtex'
  content TEXT NOT NULL,
  generatedAt DATETIME NOT NULL,
  FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE
);
```

### 3.3 Event Bus Events
```typescript
// Emitted
export const PDF_VIEWER_OPENED = 'pdf:viewer:opened';
export const PDF_VIEWER_CLOSED = 'pdf:viewer:closed';
export const ANNOTATION_CREATED = 'annotation:created';
export const ANNOTATION_UPDATED = 'annotation:updated';
export const ANNOTATION_DELETED = 'annotation:deleted';
export const PAPER_THEME_CHANGED = 'paper:theme:changed';
export const LATEX_EXPORT_REQUESTED = 'latex:export:requested';
export const LATEX_INSERT_REQUESTED = 'latex:insert:requested';
```

---

## 4. Main Interaction Flows

### 4.1 Open PDF
```
User clicks paper in list
  → ListWebviewPanel emits command 'labshelf.openPdfViewer'
  → PdfViewerPanel.createOrShow()
  → Renders PDF with PDF.js
  → Restores annotations from database
  → Applies theme (preference or auto)
  → Event: PDF_VIEWER_OPENED
```

### 4.2 Create Highlight
```
User selects text in PDF
  → Context menu or selection popup
  → Chooses color
  → AnnotationManager.createHighlight()
    → Save to DB (annotations)
    → Emit ANNOTATION_CREATED
  → Highlight rendered permanently
```

### 4.3 Export to LaTeX
```
User clicks "Export to LaTeX"
  → Dialog asks for format (structured summary / simple summary / BibTeX+notes)
  → LatexExporter generates content based on template
  → Option 1: Save file
  → Option 2: Copy to clipboard
  → Option 3: Insert into open .tex file
```

### 4.4 Insert into LaTeX Workshop
```
User clicks "Insert into LaTeX Document"
  → Check if LaTeX Workshop is active
  → List open .tex files
  → User selects destination file
  → Insert structured block with \cite{} and notes
  → Event: LATEX_INSERT_REQUESTED
  → Log and confirmation
```

---

## 5. Implementation Phases

### Phase 1: MVP — Basic PDF Viewer (Sprint 1)
- [ ] Create `PdfViewerPanel` rendering PDF.js
- [ ] Basic navigation (next/prev, zoom)
- [ ] Theme synchronized with VS Code (auto-detect)
- [ ] Spec: `pdf-viewer-basic.spec.yaml`
- [ ] Tests: ~60% coverage

### Phase 2: Simple Annotations (Sprint 2)
- [ ] Tables `annotations` and `paperThemePreferences`
- [ ] Create/view highlights with colors
- [ ] Annotation sidebar
- [ ] Spec: `annotations.spec.yaml`
- [ ] Tests: ~70% coverage

### Phase 3: Advanced Themes (Sprint 3)
- [ ] Theme selection UI in the navbar
- [ ] Preferences persisted per paper
- [ ] Themes: light, dark, sepia, high-contrast
- [ ] Update existing spec

### Phase 4: LaTeX Export (Sprint 4)
- [ ] `LatexExporter` generating templates
- [ ] "Export to LaTeX" command
- [ ] Generate structured summaries
- [ ] Spec: `latex-export.spec.yaml`
- [ ] Tests: ~75% coverage

### Phase 5: LaTeX Workshop Integration (Sprint 5)
- [ ] Detect LaTeX Workshop (active extension)
- [ ] `LatexWorkshopBridge` communicating via VS Code API
- [ ] Insert blocks into open .tex files
- [ ] Command palette commands
- [ ] Spec: `latex-workshop-integration.spec.yaml`
- [ ] Tests: ~80% coverage

### Phase 6: Polish and Extras (Sprint 6+)
- [ ] Search within annotations
- [ ] Edit/delete annotations inline
- [ ] Customizable tags
- [ ] Synchronization across multiple openings
- [ ] Robust error handling
- [ ] Optimized performance

---

## 6. Technical Considerations

### 6.1 PDF.js Worker
- Infrastructure to resolve the worker correctly in the extension host already exists
- Reuse the existing pattern of `require.resolve()` + `pathToFileURL`

### 6.2 Webview Security
- Scripts enabled in the webview (required for PDF.js)
- Validate content inserted into LaTeX (escape special characters)
- Sanitize user input in comments

### 6.3 Performance
- Load PDF with lazy page loading when possible
- Cache rendered pages
- Debounce selection events
- Avoid unnecessary re-renders

### 6.4 Persistent State
- Annotations: SQLite
- Theme preference: SQLite
- Scroll position/current page: Webview memory (retainContextWhenHidden: true)

---

## 7. New Dependencies (Potential)

- ✅ `pdfjs-dist` (already present)
- ❓ `latex-parser` (simple .tex parsing, optional)
- ❓ `dom-to-image` (export annotations as image, optional)
- ❓ `bibtex-parser` (dependency already exists, optimize if needed)

---

## 8. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| PDF.js slowness with large PDFs | Medium | High | Implement virtualization / lazy-load |
| LaTeX Workshop may not be installed | High | Low | Graceful degradation, prior checks |
| Rendering conflict webview/PDF.js | Low | High | Test with complex PDFs in the MVP |
| Annotation synchronization across openings | Medium | Medium | Event bus + automatic reload |
| LaTeX export with special characters | Medium | Medium | Escape + test with various PDFs |

---

## 9. Success Metrics

- ✅ MVP opens in <2s for normal papers
- ✅ Highlights persist and load correctly
- ✅ Valid LaTeX export tested with `pdflatex`
- ✅ 75%+ test coverage
- ✅ User can insert summary into a .tex document in <10 seconds
- ✅ Zero unhandled errors in logs

---

## 10. Immediate Next Steps

1. User feedback on this plan
2. Create spec YAML for Basic PDF Viewer (Phase 1)
3. Sketch HTML/CSS for the PDF webview
4. Begin implementing `PdfViewerPanel`
5. Set up integration tests with PDF.js
