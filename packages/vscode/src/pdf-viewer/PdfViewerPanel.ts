/**
 * Module: PdfViewerPanel
 * Responsibility: Create and manage webview panels for PDF viewing with annotations and theming
 * Dependencies: vscode, PaperService, EventBus, ThemeManager, AnnotationManager, PdfRenderer
 */
import * as vscode from "vscode";
import type { PaperService } from "../core/paperService.js";
import type { ExtensionEventBus } from "../core/eventBus.js";
import type { PaperRecord, Annotation, PdfTheme } from "../core/types.js";
import { EVENTS } from "../constants/events.js";
import { ThemeManager } from "./ThemeManager.js";
import { AnnotationManager } from "./AnnotationManager.js";
import { PdfRenderer, getPdfjsDirectory } from "./PdfRenderer.js";
import { PDF_VIEWER_CONFIG } from "./config.js";

// Track open panels by paperId so we can reveal instead of re-creating
const openPanels = new Map<string, PdfViewerPanel>();

export class PdfViewerPanel {
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _currentPage = 1;
  private _zoomLevel: number = PDF_VIEWER_CONFIG.DEFAULT_ZOOM;
  private _themePreference: string;
  private readonly _paperId: string;
  private readonly _renderer = new PdfRenderer();
  private _disposed = false;

  /** Reset all tracked panels — for testing only */
  static _clearAllForTesting(): void {
    openPanels.clear();
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    paperService: PaperService,
    eventBus: ExtensionEventBus,
    themeManager: ThemeManager,
    annotationManager: AnnotationManager,
    paper?: PaperRecord,
  ): void {
    if (!paper) {
      // No paper provided — open a picker or do nothing
      return;
    }

    const existing = openPanels.get(paper.id);
    if (existing) {
      existing._panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    const pdfUri = vscode.Uri.joinPath(vscode.Uri.file(paper.path), 'paper.pdf');
    const pdfjsDir = getPdfjsDirectory();
    const paperDirUri = vscode.Uri.file(paper.path);

    const resourceRoots: vscode.Uri[] = [extensionUri, paperDirUri];
    if (pdfjsDir) { resourceRoots.push(pdfjsDir); }

    const panel = vscode.window.createWebviewPanel(
      'labshelfPdf',
      paper.title,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: resourceRoots,
      },
    );

    new PdfViewerPanel(
      panel, extensionUri, pdfUri, paper,
      paperService, eventBus, themeManager, annotationManager,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    pdfUri: vscode.Uri,
    paper: PaperRecord,
    paperService: PaperService,
    eventBus: ExtensionEventBus,
    private readonly themeManager: ThemeManager,
    private readonly annotationManager: AnnotationManager,
  ) {
    this._panel = panel;
    this._paperId = paper.id;
    this._themePreference = 'auto';

    openPanels.set(paper.id, this);

    // Load theme preference and annotations, then render
    this._initialize(pdfUri, paper).catch((err) => {
      vscode.window.showErrorMessage(`LabShelf: Failed to open PDF: ${err instanceof Error ? err.message : String(err)}`);
    });

    this._panel.webview.onDidReceiveMessage(
      (msg: Record<string, unknown>) => this._handleMessage(msg, paper),
      null,
      this._disposables,
    );

    // Update the active theme without rebuilding the webview for faster response.
    const themeDisposable = themeManager.onVsCodeThemeChange((newTheme) => {
      if (this._themePreference === 'auto') {
        void this._panel.webview.postMessage({
          type: 'applyTheme',
          theme: 'auto',
          effectiveTheme: newTheme,
        });
      }
    });
    this._disposables.push(themeDisposable);

    this._panel.onDidDispose(() => {
      eventBus.emit(EVENTS.PDF_VIEWER_CLOSED, {
        paperId: paper.id,
        currentPage: this._currentPage,
        timestamp: new Date().toISOString(),
      });
      openPanels.delete(paper.id);
      this.dispose();
    }, null, this._disposables);

    eventBus.emit(EVENTS.PDF_VIEWER_OPENED, {
      paperId: paper.id,
      timestamp: new Date().toISOString(),
    });
  }

  private async _initialize(pdfUri: vscode.Uri, paper: PaperRecord): Promise<void> {
    const themePreferencePromise = this.themeManager.getThemeForPaper(paper.id);
    const annotationsPromise = this.annotationManager.getAnnotationsByPaper(paper.id);

    this._panel.webview.html = this._renderer.generateHtml({
      webview: this._panel.webview,
      extensionUri: this._panel.webview.options as unknown as vscode.Uri,
      pdfUri,
      paperId: paper.id,
      paperTitle: paper.title,
      themeManager: this.themeManager,
      themePreference: 'auto',
      initialPage: this._currentPage,
      initialZoom: this._zoomLevel,
      annotations: [],
    });

    const resolvedThemePreference = await themePreferencePromise;
    this._themePreference = resolvedThemePreference;
    if (resolvedThemePreference !== 'auto') {
      const effectiveTheme = this.themeManager.getEffectiveTheme(resolvedThemePreference);
      await this._panel.webview.postMessage({
        type: 'applyTheme',
        theme: resolvedThemePreference,
        effectiveTheme,
      });
    }

    // Keep first paint fast and populate annotations asynchronously.
    const annotations = await annotationsPromise;
    await this._panel.webview.postMessage({ type: 'updateAnnotations', annotations });
  }

  private async _handleMessage(msg: Record<string, unknown>, paper: PaperRecord): Promise<void> {
    switch (msg['command']) {
      case 'pageChanged': {
        const page = msg['pageNumber'];
        if (typeof page === 'number') { this._currentPage = page; }
        break;
      }
      case 'zoomChanged': {
        const zoom = msg['zoomLevel'];
        if (typeof zoom === 'number') { this._zoomLevel = zoom; }
        break;
      }
      case 'selectTheme': {
        const theme = msg['theme'];
        if (typeof theme === 'string' && this.themeManager.isValidTheme(theme)) {
          this._themePreference = theme;
          await this.themeManager.setThemeForPaper(paper.id, theme as PdfTheme);
          const effectiveTheme = this.themeManager.getEffectiveTheme(theme);
          // Send updated theme to webview without full re-render
          await this._panel.webview.postMessage({
            type: 'applyTheme',
            theme,
            effectiveTheme,
          });
        }
        break;
      }
      case 'createAnnotation': {
        try {
          const type = msg['type'] as string;
          const pageNumber = msg['pageNumber'] as number;
          const content = msg['content'] as string;
          const color = msg['color'] as string;
          const position = msg['position'] as Record<string, number> | undefined;

          let annotation: Annotation;
          if (type === 'highlight') {
            const validPos = position ? this.annotationManager.validatePosition(position) : undefined;
            annotation = await this.annotationManager.createHighlight(
              paper.id, pageNumber, content,
              color as Annotation['color'] ?? 'yellow',
              validPos,
            );
          } else {
            annotation = await this.annotationManager.createNote(paper.id, pageNumber, content);
          }

          const all = await this.annotationManager.getAnnotationsByPaper(paper.id);
          await this._panel.webview.postMessage({ type: 'updateAnnotations', annotations: all });
        } catch (err) {
          vscode.window.showErrorMessage(
            `LabShelf: Failed to create annotation: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }
      case 'deleteAnnotation': {
        const id = msg['id'] as string;
        if (id) {
          try {
            await this.annotationManager.deleteAnnotation(id, paper.id);
            const all = await this.annotationManager.getAnnotationsByPaper(paper.id);
            await this._panel.webview.postMessage({ type: 'updateAnnotations', annotations: all });
          } catch (err) {
            vscode.window.showErrorMessage(
              `LabShelf: Failed to delete annotation: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        break;
      }
      case 'updateAnnotation': {
        const id = msg['id'] as string;
        const content = msg['content'] as string;
        if (id && content) {
          try {
            await this.annotationManager.updateAnnotation(id, content);
            const all = await this.annotationManager.getAnnotationsByPaper(paper.id);
            await this._panel.webview.postMessage({ type: 'updateAnnotations', annotations: all });
          } catch (err) {
            vscode.window.showErrorMessage(
              `LabShelf: Failed to update annotation: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        break;
      }
    }
  }

  dispose(): void {
    if (this._disposed) { return; }
    this._disposed = true;
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
    this._panel.dispose();
  }
}
