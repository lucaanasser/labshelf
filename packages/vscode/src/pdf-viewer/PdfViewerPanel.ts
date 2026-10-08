/**
 * Creates and manages the PDF reader webview panels: lifecycle, the typed host side of the reader protocol, reading-state persistence, clipboard/export actions and reading analytics.
 */
import * as vscode from "vscode";
import {
  type EventBus,
  type ILogger,
  type PaperRecord,
  type Annotation,
  type PdfTheme,
  type ReadingEvent,
  EVENTS,
  formatAnnotationsMarkdown,
  formatQuoteWithCitation,
  isSafeExternalUrl,
  paperFiles,
  isPdfTheme,
  isWebviewMessage,
  normalizeReadingState,
  type EffectiveTheme,
  type HostToWebview,
  type ReaderCommandId,
  type ReadingState,
  type WebviewToHost,
} from "@labshelf/core";
import { ThemeManager } from "./ThemeManager.js";
import { AnnotationManager } from "./AnnotationManager.js";
import { PdfRenderer, getPdfjsDirectory, getReaderBundleDirectory } from "./renderer/PdfRenderer.js";
import { READER_CONFIG_SECTION, getReaderPrefs, getReaderViewColumn } from "./readerPrefs.js";
import { labshelfTabIcon } from "../ui/tabIcon.js";

export const READER_VIEW_TYPE = "labshelfPdf";

// A page counts as read, for analytics, once the reader has stayed on it this long.
const MIN_DWELL_MS = 5000;

/** The slice of PaperDataStore the reader needs; kept structural so tests can pass a stub. */
export interface ReadingStateStore {
  getReadingState(paperId: string): Promise<ReadingState | null>;
  setReadingState(paperId: string, state: ReadingState): Promise<void>;
}

export interface PdfViewerDeps {
  extensionUri: vscode.Uri;
  eventBus: EventBus;
  themeManager: ThemeManager;
  annotationManager: AnnotationManager;
  readingStore?: ReadingStateStore;
  logger?: ILogger;
  /** Reading analytics sink (the AI subsystem's reading_events), absent when AI is disabled. */
  onReadingEvent?: (event: ReadingEvent) => void;
}

export interface OpenOptions {
  /** Jump to this page once open (or immediately, when the paper's panel already exists). */
  page?: number;
}

// Track open panels by paperId so we can reveal instead of re-creating
const openPanels = new Map<string, PdfViewerPanel>();

export class PdfViewerPanel {
  private static activePanel: PdfViewerPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _currentPage = 1;
  private _themePreference: PdfTheme = "auto";
  private readonly _renderer = new PdfRenderer();
  private _disposed = false;
  private readonly _openedAt = Date.now();
  private _pageEnteredAt = Date.now();
  private _pendingPage: number | undefined;
  private _visible = true;
  private _closed = false;

  /**
   * Clears the map of open panels — intended for use in tests only.
   * @usedBy tests
   * @returns void
   */
  static _clearAllForTesting(): void {
    openPanels.clear();
    PdfViewerPanel.activePanel = undefined;
  }

  /**
   * Sends a reader command (contributed keybinding or palette command) to the focused reader panel.
   * @usedBy extension.ts (labshelf.reader.* commands)
   * @returns true when a reader panel was focused and received the command.
   */
  static postToActive(id: ReaderCommandId): boolean {
    const panel = PdfViewerPanel.activePanel;
    if (!panel || panel._disposed) { return false; }
    panel._post({ type: "command", id });
    return true;
  }

  /**
   * Reveals an existing panel for the paper if one is open, or creates and initializes a new webview panel.
   * @usedBy extension.ts
   * @returns void
   */
  static createOrShow(deps: PdfViewerDeps, paper: PaperRecord, options: OpenOptions = {}): void {
    const existing = openPanels.get(paper.id);
    if (existing) {
      existing._panel.reveal();
      if (options.page) { existing._post({ type: "scrollToPage", pageNumber: options.page }); }
      return;
    }

    const paperDirUri = vscode.Uri.file(paper.path);
    const pdfUri = paperFiles(paperDirUri, vscode.Uri.joinPath).pdf;
    const pdfjsDir = getPdfjsDirectory();
    const resourceRoots: vscode.Uri[] = [getReaderBundleDirectory(deps.extensionUri), paperDirUri];
    if (pdfjsDir) { resourceRoots.push(pdfjsDir); }

    const panel = vscode.window.createWebviewPanel(
      READER_VIEW_TYPE,
      paper.title,
      getReaderViewColumn(),
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: resourceRoots,
        // enableFindWidget stays off: VS Code's widget would swallow Ctrl/Cmd+F and search the chrome's DOM,
        // not the PDF text the reader's own find bar covers.
      },
    );
    panel.iconPath = labshelfTabIcon(deps.extensionUri);

    new PdfViewerPanel(panel, deps, pdfUri, paper, options);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly deps: PdfViewerDeps,
    pdfUri: vscode.Uri,
    private readonly paper: PaperRecord,
    options: OpenOptions,
  ) {
    this._panel = panel;
    this._pendingPage = options.page;
    openPanels.set(paper.id, this);
    if (panel.active) { PdfViewerPanel.activePanel = this; }

    this._panel.webview.onDidReceiveMessage(
      (msg: unknown) => { void this._handleMessage(msg); },
      null,
      this._disposables,
    );

    // The shell is assigned synchronously so the webview starts fetching pdf.js and the PDF at once;
    // everything that needs disk (theme, annotations, reading position) follows in the `init` reply.
    this._panel.webview.html = this._renderer.generateHtml({
      webview: this._panel.webview,
      extensionUri: deps.extensionUri,
      pdfUri,
      paperId: paper.id,
      paperTitle: paper.title,
      themeManager: deps.themeManager,
      themePreference: "auto",
      prefs: getReaderPrefs(),
    });

    // Update the active theme without rebuilding the webview for faster response.
    this._disposables.push(deps.themeManager.onVsCodeThemeChange((newTheme) => {
      if (this._themePreference === "auto") {
        this._post({ type: "applyTheme", theme: "auto", effectiveTheme: newTheme as EffectiveTheme });
      }
    }));

    this._disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(READER_CONFIG_SECTION)) {
        this._post({ type: "prefsChanged", prefs: getReaderPrefs() });
      }
    }));

    this._panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        PdfViewerPanel.activePanel = this;
      } else if (PdfViewerPanel.activePanel === this) {
        PdfViewerPanel.activePanel = undefined;
      }
      // Time spent with the panel in the background is not reading time.
      if (e.webviewPanel.visible && !this._visible) {
        this._visible = true;
        this._pageEnteredAt = Date.now();
      } else if (!e.webviewPanel.visible && this._visible) {
        this._recordDwell();
        this._visible = false;
      }
    }, null, this._disposables);

    this._panel.onDidDispose(() => {
      // dispose() below re-enters panel.dispose(); close-out must happen exactly once.
      if (this._closed) { return; }
      this._closed = true;
      this._recordDwell();
      this._emitReadingEvent({ kind: "close", page: this._currentPage, durationMs: Date.now() - this._openedAt });
      deps.eventBus.emit(EVENTS.PDF_VIEWER_CLOSED, {
        paperId: paper.id,
        currentPage: this._currentPage,
        timestamp: new Date().toISOString(),
      });
      openPanels.delete(paper.id);
      if (PdfViewerPanel.activePanel === this) { PdfViewerPanel.activePanel = undefined; }
      this.dispose();
    }, null, this._disposables);

    deps.eventBus.emit(EVENTS.PDF_VIEWER_OPENED, {
      paperId: paper.id,
      timestamp: new Date().toISOString(),
    });
  }

  private _post(msg: HostToWebview): void {
    if (this._disposed) { return; }
    void this._panel.webview.postMessage(msg);
  }

  private async _sendInit(): Promise<void> {
    const { themeManager, annotationManager, readingStore } = this.deps;
    const paperId = this.paper.id;
    const [theme, annotations, reading] = await Promise.all([
      themeManager.getThemeForPaper(paperId),
      annotationManager.getAnnotationsByPaper(paperId),
      readingStore ? readingStore.getReadingState(paperId).catch(() => null) : Promise.resolve(null),
    ]);
    this._themePreference = theme;
    this._post({
      type: "init",
      reading,
      annotations,
      prefs: getReaderPrefs(),
      theme,
      effectiveTheme: themeManager.getEffectiveTheme(theme) as EffectiveTheme,
    });
  }

  private async _refreshAnnotations(): Promise<void> {
    const all = await this.deps.annotationManager.getAnnotationsByPaper(this.paper.id);
    this._post({ type: "updateAnnotations", annotations: all });
  }

  private async _handleMessage(raw: unknown): Promise<void> {
    if (!isWebviewMessage(raw)) {
      void this.deps.logger?.log("WARN", "pdf-viewer", "Ignored malformed reader message", { paperId: this.paper.id });
      return;
    }
    try {
      await this._dispatch(raw);
    } catch (err) {
      vscode.window.showErrorMessage(
        `LabShelf: Reader action failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async _dispatch(msg: WebviewToHost): Promise<void> {
    const { paper } = this;
    const { themeManager, annotationManager } = this.deps;
    switch (msg.command) {
      case "ready-for-init":
        await this._sendInit();
        break;
      case "ready":
        this._pageEnteredAt = Date.now();
        this._emitReadingEvent({ kind: "open" });
        if (this._pendingPage) {
          this._post({ type: "scrollToPage", pageNumber: this._pendingPage });
          this._pendingPage = undefined;
        }
        break;
      case "perf":
        // hostMs spans the whole open as the user feels it; timeline entries are ms since the webview began loading.
        void this.deps.logger?.log("INFO", "pdf-viewer", "PDF open timeline", {
          paperId: paper.id,
          hostMs: Date.now() - this._openedAt,
          timeline: msg.timeline,
          theme: msg.theme,
          dpr: msg.dpr,
          canvas: msg.canvas,
        });
        break;
      case "pageChanged":
        if (msg.pageNumber !== this._currentPage) {
          this._recordDwell();
          this._currentPage = msg.pageNumber;
        }
        break;
      case "zoomChanged":
        // Superseded by saveReadingState; still accepted from older bundles.
        break;
      case "selectTheme":
        if (isPdfTheme(msg.theme)) {
          this._themePreference = msg.theme;
          await themeManager.setThemeForPaper(paper.id, msg.theme);
          // Send updated theme to webview without full re-render
          this._post({
            type: "applyTheme",
            theme: msg.theme,
            effectiveTheme: themeManager.getEffectiveTheme(msg.theme) as EffectiveTheme,
          });
        }
        break;
      case "createAnnotation":
        try {
          if (msg.type === "highlight") {
            const validPos = msg.position ? annotationManager.validatePosition(msg.position) : undefined;
            await annotationManager.createHighlight(
              paper.id, msg.pageNumber, msg.content,
              (msg.color as Annotation["color"]) ?? "yellow",
              validPos,
            );
          } else {
            await annotationManager.createNote(paper.id, msg.pageNumber, msg.content);
          }
          this._emitReadingEvent({ kind: "annotate", page: msg.pageNumber });
          await this._refreshAnnotations();
        } catch (err) {
          vscode.window.showErrorMessage(
            `LabShelf: Failed to create annotation: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      case "deleteAnnotation":
        try {
          await annotationManager.deleteAnnotation(msg.id, paper.id);
          await this._refreshAnnotations();
        } catch (err) {
          vscode.window.showErrorMessage(
            `LabShelf: Failed to delete annotation: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      case "updateAnnotation":
        try {
          await annotationManager.updateAnnotation(msg.id, msg.content);
          await this._refreshAnnotations();
        } catch (err) {
          vscode.window.showErrorMessage(
            `LabShelf: Failed to update annotation: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      case "saveReadingState": {
        const state = normalizeReadingState(msg.state);
        if (state && this.deps.readingStore) {
          await this.deps.readingStore.setReadingState(paper.id, state);
        }
        break;
      }
      case "copyWithCitation": {
        const text = formatQuoteWithCitation(msg.text, paper, msg.pageNumber, getReaderPrefs().citationStyle);
        await vscode.env.clipboard.writeText(text);
        vscode.window.setStatusBarMessage(`Copied with citation (@${paper.citeKey}, p. ${msg.pageNumber})`, 2500);
        break;
      }
      case "copyText":
        await vscode.env.clipboard.writeText(msg.text);
        vscode.window.setStatusBarMessage("Copied to clipboard", 2000);
        break;
      case "exportAnnotations":
        await PdfViewerPanel.exportAnnotations(annotationManager, paper, msg.target);
        break;
      case "openExternalLink":
        if (isSafeExternalUrl(msg.url)) {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } else {
          void this.deps.logger?.log("WARN", "pdf-viewer", "Blocked external link with disallowed scheme", { paperId: paper.id });
        }
        break;
      default: {
        const unreachable: never = msg;
        void unreachable;
      }
    }
  }

  /**
   * Exports a paper's annotations as Markdown to the clipboard or to a file chosen by the user (default: <paper folder>/annotations.md).
   * @usedBy pdf-viewer/PdfViewerPanel.ts (exportAnnotations message), extension.ts (labshelf.exportAnnotations)
   * @returns void
   */
  static async exportAnnotations(
    annotationManager: AnnotationManager,
    paper: PaperRecord,
    target: "clipboard" | "file",
  ): Promise<void> {
    const markdown = formatAnnotationsMarkdown(paper, await annotationManager.getAnnotationsByPaper(paper.id));
    if (target === "clipboard") {
      await vscode.env.clipboard.writeText(markdown);
      vscode.window.setStatusBarMessage("Annotations copied as Markdown", 2500);
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(vscode.Uri.file(paper.path), "annotations.md"),
      filters: { Markdown: ["md"] },
    });
    if (!uri) { return; }
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(markdown));
    await vscode.window.showTextDocument(uri, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  }

  private _recordDwell(): void {
    const now = Date.now();
    const durationMs = now - this._pageEnteredAt;
    this._pageEnteredAt = now;
    if (durationMs >= MIN_DWELL_MS && this._visible) {
      this._emitReadingEvent({ kind: "scroll", page: this._currentPage, durationMs });
    }
  }

  private _emitReadingEvent(event: Omit<ReadingEvent, "paperId" | "occurredAt">): void {
    try {
      this.deps.onReadingEvent?.({ paperId: this.paper.id, occurredAt: Date.now(), ...event });
    } catch {
      // Analytics must never disturb reading.
    }
  }

  /**
   * Disposes all disposables and the underlying webview panel, guarded against double-disposal.
   * @usedBy pdf-viewer/PdfViewerPanel.ts (self, on panel close event)
   * @returns void
   */
  dispose(): void {
    if (this._disposed) { return; }
    this._disposed = true;
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
    this._panel.dispose();
  }
}
