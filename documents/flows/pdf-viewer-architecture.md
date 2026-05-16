# Arquitetura e Fluxos - PDF Viewer com Anotações

## 1. Arquitetura de Camadas Estendida

```
┌─────────────────────────────────────────────────────────────────┐
│                     VS Code Extension UI Layer                   │
│                                                                   │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │  Sidebar Tree    │    │  List Panel      │                   │
│  │  (existente)     │    │  (existente)     │                   │
│  └────────┬─────────┘    └────────┬─────────┘                   │
│           │                       │                              │
│           └───────────┬───────────┘                              │
│                       │                                          │
│           ┌───────────▼────────────────────┐                    │
│           │   PDF Viewer Panel (NOVO)      │                    │
│           │  ├─ PDF.js Renderer            │                    │
│           │  ├─ Annotation UI              │                    │
│           │  ├─ Theme Selector             │                    │
│           │  └─ Toolbar & Navigation       │                    │
│           └───────────┬────────────────────┘                    │
└─────────────────────────┼──────────────────────────────────────┘
                          │
┌─────────────────────────┼──────────────────────────────────────┐
│              Services Layer (Negócio)                            │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  pdf-viewer/ (NOVO)                        │ │
│  │ ┌──────────────────┐ ┌──────────────────┐                 │ │
│  │ │ PdfViewerPanel   │ │ AnnotationMgr    │                 │ │
│  │ └──────────────────┘ └──────────────────┘                 │ │
│  │ ┌──────────────────┐ ┌──────────────────┐                 │ │
│  │ │ PdfRenderer      │ │ ThemeManager     │                 │ │
│  │ └──────────────────┘ └──────────────────┘                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              pdf-export/ (NOVO)                            │ │
│  │ ┌──────────────────┐ ┌──────────────────┐                 │ │
│  │ │ LatexExporter    │ │ MarkdownExporter │                 │ │
│  │ └──────────────────┘ └──────────────────┘                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │          latex-integration/ (NOVO)                         │ │
│  │ ┌──────────────────┐ ┌──────────────────┐                 │ │
│  │ │ LatexWorkshopBrg │ │ DocumentInserter │                 │ │
│  │ └──────────────────┘ └──────────────────┘                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │    PaperService, EventBus, Logger (existentes)              ││
│  └─────────────────────────────────────────────────────────────┘│
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────┼─────────────────────────────────────────┐
│                  Data & Storage                                   │
│                         │                                         │
│  ┌──────────────────────▼──────────────────┐                    │
│  │ SQLite Database (db/)                    │                    │
│  │ ├─ papers (existente)                    │                    │
│  │ ├─ annotations (NOVO)                    │                    │
│  │ ├─ paperThemePreferences (NOVO)          │                    │
│  │ └─ generatedSummaries (NOVO)             │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                   │
│  ┌─────────────────────────────────────────┐                    │
│  │ Filesystem (storage/)                    │                    │
│  │ ├─ Paper files (existente)               │                    │
│  │ └─ Generated LaTeX/Markdown (NOVO)       │                    │
│  └─────────────────────────────────────────┘                    │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. Fluxo de Dados - Abrir e Anotar PDF

```
User clicks paper in list
         │
         ▼
   List Panel receives selection
         │
         ▼
   Emit: labshelf.openPdfViewer
         │
         ▼
   PdfViewerPanel.createOrShow(paperId)
         │
         ├─ Load paper metadata from PaperService
         │
         ├─ Load PDF bytes from filesystem
         │
         ├─ Query: paperThemePreferences (for paperId)
         │
         ├─ ThemeManager.getTheme()
         │  ├─ If 'auto' → detect VS Code theme
         │  └─ Return effective theme (light/dark/sepia/etc)
         │
         ├─ Query: annotations (for paperId)
         │
         ├─ Render webview with:
         │  ├─ PDF via PDF.js
         │  ├─ Theme applied to webview CSS
         │  └─ Annotations overlay
         │
         ├─ Event: PDF_VIEWER_OPENED
         │
         ▼
   [PDF displayed and ready]
         │
         │─ User selects text
         │     │
         │     ▼
         │  Context menu appears (Add highlight, Add note)
         │     │
         │     ├─ User chooses color (yellow, green, blue, red, pink)
         │     │
         │     ▼
         │  AnnotationManager.createHighlight({
         │      paperId, pageNumber, text, color, position
         │  })
         │     │
         │     ├─ Save to DB: INSERT annotations
         │     ├─ Event: ANNOTATION_CREATED
         │     ├─ Render highlight on PDF
         │     └─ Add to annotations sidebar
         │
         │─ User clicks to open sidebar
         │     │
         │     ▼
         │  Display all annotations for paper
         │  (grouped by page, colored labels)
         │
         │─ User clicks annotation in sidebar
         │     │
         │     ▼
         │  Scroll PDF to page + highlight it
         │
         │─ User clicks "Edit" on annotation
         │     │
         │     ▼
         │  Update DB + re-render
         │  Event: ANNOTATION_UPDATED
         │
         │─ User clicks "Delete" on annotation
         │     │
         │     ▼
         │  Delete from DB
         │  Event: ANNOTATION_DELETED
         │  Remove from UI
         │
         └─ User closes viewer
              Event: PDF_VIEWER_CLOSED
```

---

## 3. Fluxo de Exportação LaTeX

```
User clicks "Export to LaTeX" button
         │
         ▼
   Dialog: Choose export type
   ├─ Structured Summary (with sections)
   ├─ Simple Summary (flat list)
   ├─ BibTeX + Notes
   └─ Custom Template
         │
         ▼
   User selects option + destination (save/copy/insert)
         │
         ▼
   LatexExporter.generateSummary({
       paperId, type, annotations
   })
         │
         ├─ Fetch paper metadata
         ├─ Fetch all annotations (ordered by page)
         ├─ Build LaTeX template:
         │  ├─ \cite{citekey}
         │  ├─ \section*{Key Highlights}
         │  ├─ \begin{itemize}
         │  │  \item [highlight 1]
         │  │  \item [highlight 2]
         │  └─ \end{itemize}
         │
         ├─ Escape special chars (\, &, $, %, _, {, })
         ├─ Cache in DB: generatedSummaries
         └─ Return LaTeX string
         │
         ▼
   User chooses destination:
   
   [If "Save File"]
      │
      ├─ Dialog: Where to save?
      ├─ Write file (storage layer)
      ├─ Notification: "Summary saved to path"
      └─ (Optional) Open in editor
      
   [If "Copy to Clipboard"]
      │
      ├─ vscode.env.clipboard.writeText(latexString)
      ├─ Notification: "Copied to clipboard"
      └─ Ready to paste in .tex file
      
   [If "Insert into LaTeX Document"]
      │
      ├─ LaTeX Workshop bridge check:
      │  └─ Is LaTeX Workshop extension active?
      │
      ├─ List open .tex files:
      │  └─ Quick pick dialog
      │
      ├─ DocumentInserter.insertIntoDocument({
      │     documentUri, position, content
      │  })
      │  ├─ Open document (if not already)
      │  ├─ Find insertion point (end of file or selected)
      │  ├─ Apply edit via WorkspaceEdit API
      │  └─ Save document
      │
      └─ Event: LATEX_INSERT_REQUESTED
         Notification: "Inserted into Document.tex"
```

---

## 4. Fluxo de Sincronização de Tema

```
1. Extension starts
   │
   └─> ThemeManager.initialize()
       ├─ Listen to vscode.window.onDidChangeActiveColorTheme
       └─ Listen to configuration changes

2. User opens PDF
   │
   └─> PdfViewerPanel.createOrShow()
       │
       ├─ Query: SELECT theme FROM paperThemePreferences WHERE paperId = ?
       │  ├─ If found: use stored preference
       │  └─ If NOT found: use 'auto'
       │
       └─> PdfRenderer.applyTheme(theme)
           ├─ If 'auto':
           │  ├─ Get current VS Code theme (vscode.window.activeColorTheme.kind)
           │  ├─ Map: VS Code theme → PDF theme
           │  │   ├─ ColorThemeKind.Dark → 'dark'
           │  │   ├─ ColorThemeKind.Light → 'light'
           │  │   └─ ColorThemeKind.HighContrast → 'high-contrast'
           │  └─ Apply theme CSS
           │
           └─ If explicit theme (light/dark/sepia/etc):
              └─ Apply theme CSS directly

3. User changes VS Code theme (while PDF viewer open)
   │
   └─> ThemeManager emits VSCODE_THEME_CHANGED
       │
       └─> If paper theme is 'auto':
           └─> PdfViewerPanel re-applies theme
               └─> PDF re-renders with new colors

4. User changes PDF theme in navbar dropdown
   │
   └─> PdfViewerPanel receives theme selection
       │
       ├─ Update DB: paperThemePreferences
       ├─ Apply new theme CSS
       ├─ Event: PAPER_THEME_CHANGED
       └─ Persist preference (survives reopening)
```

---

## 5. Eventos do Event Bus (Completo)

```typescript
// PDF Viewer Lifecycle
export const PDF_VIEWER_OPENED = 'pdf:viewer:opened';
export const PDF_VIEWER_CLOSED = 'pdf:viewer:closed';

// Annotations
export const ANNOTATION_CREATED = 'annotation:created';
export const ANNOTATION_UPDATED = 'annotation:updated';
export const ANNOTATION_DELETED = 'annotation:deleted';

// Theme
export const PAPER_THEME_CHANGED = 'paper:theme:changed';
export const VSCODE_THEME_CHANGED = 'vscode:theme:changed';

// Export & Integration
export const LATEX_EXPORT_REQUESTED = 'latex:export:requested';
export const LATEX_INSERT_REQUESTED = 'latex:insert:requested';
export const LATEX_EXPORT_COMPLETED = 'latex:export:completed';
export const LATEX_INSERT_COMPLETED = 'latex:insert:completed';

// Listeners would handle synchronization:
// - Update sidebar when annotations change
// - Refresh summary cache when annotations change
// - Notify user of successful operations
```

---

## 6. Estrutura de Dados - Annotation

```typescript
interface Annotation {
  id: string;              // UUID
  paperId: string;         // Foreign key
  type: 'highlight' | 'note' | 'comment' | 'tag';
  pageNumber: number;
  content: string;         // Texto selecionado ou nota
  color?: string;          // 'yellow' | 'green' | 'blue' | 'red' | 'pink'
  position?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  metadata?: {
    tags?: string[];
    relatedAnnotationIds?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

interface PaperThemePreference {
  paperId: string;
  theme: 'auto' | 'light' | 'dark' | 'sepia' | 'high-contrast';
  updatedAt: Date;
}

interface GeneratedSummary {
  id: string;              // UUID
  paperId: string;
  format: 'latex' | 'markdown' | 'bibtex';
  content: string;
  generatedAt: Date;
  checksum?: string;       // Para detectar se anotações mudaram
}
```

---

## 7. Pontos de Integração com LaTeX Workshop

### 7.1 Detectar Instalação
```typescript
// LatexWorkshopBridge
const isLatexWorkshopInstalled = (): boolean => {
  const ext = vscode.extensions.getExtension('James-Yu.latex-workshop');
  return ext !== undefined;
};
```

### 7.2 Obter Arquivos Abertos
```typescript
const getOpenLatexDocuments = (): vscode.TextDocument[] => {
  return vscode.workspace.textDocuments.filter(doc => 
    doc.languageId === 'latex' && !doc.isUntitled
  );
};
```

### 7.3 Inserir Conteúdo
```typescript
// DocumentInserter
async insertIntoDocument(
  documentUri: vscode.Uri, 
  content: string,
  position?: vscode.Position
): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  const insertPos = position || new vscode.Position(Infinity, 0);
  edit.insert(documentUri, insertPos, content);
  return await vscode.workspace.applyEdit(edit);
};
```

### 7.4 Executar Comando do LaTeX Workshop (opcional)
```typescript
// Se quisermos compilar depois de inserir:
await vscode.commands.executeCommand(
  'latex-workshop.build',
  { // opções
  }
);
```

---

## 8. Segurança e Validação

### 8.1 LaTeX Escaping
```typescript
function escapeLatex(str: string): string {
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&$%#_{}]/g, (char) => '\\' + char)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}
```

### 8.2 Validação de Position JSON
```typescript
function validatePosition(pos: unknown): Position | null {
  if (!pos || typeof pos !== 'object') return null;
  const { x, y, width, height } = pos as any;
  if (typeof x === 'number' && typeof y === 'number' && 
      typeof width === 'number' && typeof height === 'number') {
    return { x, y, width, height };
  }
  return null;
}
```

---

## 9. Performance & Caching

### 9.1 Cache de Anotações
- Carregar anotações uma vez ao abrir PDF
- Manter em memória webview
- Atualizar incrementalmente via eventos

### 9.2 Cache de Summaries
- Armazenar último summary gerado
- Verificar checksum de anotações
- Regenerar apenas se mudanças detectadas

### 9.3 Lazy Loading de Páginas
- Renderizar apenas páginas visíveis + buffer
- Descarregar páginas fora de view
- Aplicar anotações apenas a páginas visíveis

---

## 10. Testing Strategy

### 10.1 Unit Tests
- `AnnotationManager`: CRUD de anotações
- `ThemeManager`: mapeamento de temas
- `LatexExporter`: geração de LaTeX
- Escaping e validação

### 10.2 Integration Tests
- Fluxo completo: abrir PDF → criar highlight → exportar
- Sincronização tema (VS Code → PDF)
- Inserção em documento LaTeX

### 10.3 E2E Tests (se aplicável)
- Abrir extensão com test PDF
- Criar anotações
- Exportar e validar conteúdo
