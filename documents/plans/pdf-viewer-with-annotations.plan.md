# PDF Viewer com Anotações e Integração LaTeX

**Data de criação**: Maio 2026  
**Status**: Planejamento  
**Prioridade**: Alta  

---

## 1. Visão Geral

Implementar um PDF viewer interativo dentro da LabShelf que:
- Substitua o abrir PDF em aplicação externa
- Funcione como painel webview nativo no VS Code
- Sincronize tema com o tema do VS Code (claro/escuro)
- Permita customização manual do tema do PDF na navbar
- Suporte anotações (highlights, notas, comentários)
- Exporte anotações e resumos em formato LaTeX
- Se integre com a extensão LaTeX Workshop para inserção direta em documentos

---

## 2. Funcionalidades Principais

### 2.1 Visualização de PDF
- ✅ Renderizar PDF completo via PDF.js
- ✅ Navegação página-a-página (primeira, última, próxima, anterior, ir para página)
- ✅ Zoom (presets: 50%, 75%, 100%, 125%, 150%, 200%)
- ✅ Busca de texto dentro do PDF
- ✅ Exibição do índice/outline do PDF (se disponível)

### 2.2 Temas e Aparência
- ✅ Tema padrão sincronizado com VS Code (dark/light/auto-detect)
- ✅ Dropdown na navbar para mudar tema PDF independentemente
- ✅ Opções de tema:
  - `auto` (segue VS Code)
  - `light`
  - `dark`
  - `sepia` (tons quentes)
  - `high-contrast` (para acessibilidade)
- ✅ Persistência de preferência de tema por paper na DB

### 2.3 Anotações
- ✅ **Highlights**: selecionar texto e grifar com cores (amarelo, verde, azul, rosa, vermelho)
- ✅ **Notas marginais**: adicionar texto livre flutuante na margem da página
- ✅ **Comentários**: associar texto longo/estruturado a uma seleção
- ✅ **Tags de referência**: marcar trechos importantes com tags customizáveis
- ✅ Visualizar lista de anotações em painel lateral
- ✅ Clicar em anotação na lista → ir para página + destacar

### 2.4 Exportação e LaTeX
- ✅ **Exportar resumo**: gerar arquivo Markdown/LaTeX com todas as notas + highlights + estrutura
- ✅ **Inserir no LaTeX Workshop**: 
  - Botão "Insert into document" que abre seletor de arquivo .tex aberto
  - Insere um bloco estruturado com citação + notas
  - Exemplo:
    ```latex
    % From: [citekey] - Title
    % Date: 2026-05-13
    
    \section*{Notes from \cite{[citekey]}}
    \begin{itemize}
      \item [highlight 1]
      \item [highlight 2]
    \end{itemize}
    ```
- ✅ **Criar novo documento LaTeX**: gerar .tex com template de resumo baseado no PDF
- ✅ **Exportar BibTeX atualizado**: incluir anotações como campos personalizados (annote, keywords)

### 2.5 Integração com LaTeX Workshop
- ✅ Verificar se LaTeX Workshop está instalado (sem erro se não estiver)
- ✅ Oferecer "Insert into document" apenas se há arquivo .tex aberto
- ✅ Command palette: "LabShelf: Insert highlights from current PDF into LaTeX"
- ✅ Quick pick para selecionar qual arquivo .tex destino

### 2.6 Gestão de Anotações
- ✅ Editar/deletar anotações existentes
- ✅ Buscar dentro de anotações de um paper
- ✅ Sincronizar anotações entre múltiplas aberturas do mesmo paper
- ✅ Backup automático de anotações em arquivo JSON ou SQL

---

## 3. Arquitetura Proposta

### 3.1 Novas Camadas
```
src/
├── pdf-viewer/              (nova)
│   ├── PdfViewerPanel.ts
│   ├── PdfRenderer.ts       (controle PDF.js)
│   ├── AnnotationManager.ts (gerenciar highlights + notas)
│   ├── ThemeManager.ts      (sincronizar com VS Code)
│   └── index.ts
│
├── pdf-export/              (nova)
│   ├── LatexExporter.ts     (gerar LaTeX a partir de anotações)
│   ├── MarkdownExporter.ts
│   └── BibTeXEnhancer.ts    (adicionar campos customizados)
│
├── latex-integration/       (nova)
│   ├── LatexWorkshopBridge.ts (detectar e comunicar com LaTeX Workshop)
│   └── DocumentInserter.ts  (inserir conteúdo em arquivos .tex)
│
└── ui/
    ├── pdfViewerWebview/    (nova)
    │   ├── pdfViewer.html
    │   ├── pdfViewer.css
    │   ├── pdfViewer.js     (lógica webview)
    │   └── annotationUI.ts
```

### 3.2 Banco de Dados (Novas Tabelas)
```sql
-- Anotações por paper
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  paperId TEXT NOT NULL,
  type TEXT NOT NULL,          -- 'highlight' | 'note' | 'comment' | 'tag'
  pageNumber INTEGER NOT NULL,
  content TEXT NOT NULL,       -- texto da nota ou highlight
  color TEXT,                  -- para highlights: 'yellow', 'green', 'blue', etc.
  position JSON,               -- {x, y, width, height} para localização exata
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE
);

-- Preferências de tema por paper
CREATE TABLE paperThemePreferences (
  paperId TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'auto', -- 'auto' | 'light' | 'dark' | 'sepia' | 'high-contrast'
  updatedAt DATETIME NOT NULL,
  FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE
);

-- Cache de resumos gerados
CREATE TABLE generatedSummaries (
  id TEXT PRIMARY KEY,
  paperId TEXT NOT NULL,
  format TEXT NOT NULL,         -- 'latex' | 'markdown' | 'bibtex'
  content TEXT NOT NULL,
  generatedAt DATETIME NOT NULL,
  FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE
);
```

### 3.3 Eventos do Event Bus
```typescript
// Emitidos
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

## 4. Fluxos de Interação Principais

### 4.1 Abrir PDF
```
Usuário clica em paper na lista
  → ListWebviewPanel emite comando 'labshelf.openPdfViewer'
  → PdfViewerPanel.createOrShow()
  → Renderiza PDF com PDF.js
  → Restaura anotações do banco
  → Aplica tema (preferência ou auto)
  → Event: PDF_VIEWER_OPENED
```

### 4.2 Criar Highlight
```
Usuário seleciona texto no PDF
  → Context menu ou popup de seleção
  → Escolhe cor
  → AnnotationManager.createHighlight()
    → Salva em DB (annotations)
    → Emite ANNOTATION_CREATED
  → Highlight renderizado permanentemente
```

### 4.3 Exportar para LaTeX
```
Usuário clica "Export to LaTeX"
  → Dialog pergunta formato (resumo estruturado / resumo simples / BibTeX+notas)
  → LatexExporter gera conteúdo baseado em template
  → Opção 1: Salvar arquivo
  → Opção 2: Copiar para clipboard
  → Opção 3: Inserir em arquivo .tex aberto
```

### 4.4 Inserir em LaTeX Workshop
```
Usuário clica "Insert into LaTeX Document"
  → Verifica se LaTeX Workshop está ativo
  → Lista arquivos .tex abertos
  → User seleciona arquivo destino
  → Insere bloco estruturado com \cite{} e notas
  → Event: LATEX_INSERT_REQUESTED
  → Log e confirmação
```

---

## 5. Fases de Implementação

### Fase 1: MVP - PDF Viewer Básico (Sprint 1)
- [ ] Criar `PdfViewerPanel` renderizando PDF.js
- [ ] Navegação básica (próx/ant, zoom)
- [ ] Tema sincronizado com VS Code (auto-detect)
- [ ] Spec: `pdf-viewer-basic.spec.yaml`
- [ ] Testes: ~60% cobertura

### Fase 2: Anotações Simples (Sprint 2)
- [ ] Tabelas `annotations` e `paperThemePreferences`
- [ ] Criar/visualizar highlights com cores
- [ ] Sidebar de anotações
- [ ] Spec: `annotations.spec.yaml`
- [ ] Testes: ~70% cobertura

### Fase 3: Temas Avançados (Sprint 3)
- [ ] UI de seleção de tema na navbar
- [ ] Preferências persistidas por paper
- [ ] Temas: light, dark, sepia, high-contrast
- [ ] Atualizar spec existente

### Fase 4: Exportação LaTeX (Sprint 4)
- [ ] `LatexExporter` gerando templates
- [ ] Comando "Export to LaTeX"
- [ ] Gerar resumos estruturados
- [ ] Spec: `latex-export.spec.yaml`
- [ ] Testes: ~75% cobertura

### Fase 5: Integração com LaTeX Workshop (Sprint 5)
- [ ] Detectar LaTeX Workshop (extensão ativa)
- [ ] `LatexWorkshopBridge` comunicando via VS Code API
- [ ] Inserir blocos em arquivos .tex abertos
- [ ] Comando palette commands
- [ ] Spec: `latex-workshop-integration.spec.yaml`
- [ ] Testes: ~80% cobertura

### Fase 6: Polimento e Extras (Sprint 6+)
- [ ] Busca dentro de anotações
- [ ] Editar/deletar anotações inline
- [ ] Tags customizáveis
- [ ] Sincronização entre múltiplas aberturas
- [ ] Tratamento de erros robusto
- [ ] Performance otimizada

---

## 6. Considerações Técnicas

### 6.1 PDF.js Worker
- Já há infra para resolver worker corretamente em extension host
- Reutilizar padrão existente de `require.resolve()` + `pathToFileURL`

### 6.2 Webview Segurança
- Scripts habilitados no webview (necessário para PDF.js)
- Validar conteúdo inserido em LaTeX (escapar caracteres especiais)
- Sanitizar entrada de usuário em comentários

### 6.3 Performance
- Carregar PDF com lazy-loading de páginas quando possível
- Cache de páginas renderizadas
- Debounce de eventos de seleção
- Evitar re-render desnecessário

### 6.4 Estado Persistente
- Anotações: SQLite
- Preferência de tema: SQLite
- Posição de scroll/página aberta: Memória webview (retainContextWhenHidden: true)

---

## 7. Dependências Novas (Potencial)

- ✅ `pdfjs-dist` (já presente)
- ❓ `latex-parser` (parsing simples de .tex, opcional)
- ❓ `dom-to-image` (exportar anotações como imagem, opcional)
- ❓ `bibtex-parser` (já tem dependência, otimizar se necessário)

---

## 8. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| PDF.js lentidão com PDFs grandes | Média | Alto | Implementar virtualization / lazy-load |
| LaTeX Workshop pode não estar instalado | Alta | Baixo | Graceful degradation, checks prévios |
| Conflito de renderização webview/PDF.js | Baixa | Alto | Testar com PDFs complexos no MVP |
| Sincronização de anotações entre aberturas | Média | Médio | Event bus + reload automático |
| Exportação LaTeX com caracteres especiais | Média | Médio | Escapar + testar com diversos PDFs |

---

## 9. Métricas de Sucesso

- ✅ MVP aberto em <2s para papers normais
- ✅ Highlights persistem e carregam corretamente
- ✅ Exportação LaTeX válida testada com `pdflatex`
- ✅ 75%+ cobertura de testes
- ✅ Usuário consegue inserir resumo em documento .tex em <10 segundos
- ✅ Zero erros não-tratados em logs

---

## 10. Próximos Passos Imediatos

1. Feedback do usuário sobre este plano
2. Criar spec YAML para PDF Viewer Básico (Fase 1)
3. Esboçar HTML/CSS do webview PDF
4. Iniciar implementação de `PdfViewerPanel`
5. Configurar testes de integração com PDF.js
