/**
 * The browser extension's side of the reader protocol: what PdfViewerPanel is in VS Code, message for message.
 * Annotations, the per-paper reader theme and the reading position go to the paper's sidecar (shared format, synced
 * with VS Code through the appdata namespace); clipboard, links, downloads and notifications go through injected
 * platform functions, so the whole dispatch runs under jest.
 *
 * @depends @labshelf/reader (protocol, PaperDataStore, citation and markdown formatting), @labshelf/core (types only)
 * @dependents reader/index
 */
import type { Annotation, PaperRecord, PdfTheme } from "@labshelf/core";
import {
  formatAnnotationsMarkdown,
  formatQuoteWithCitation,
  isPdfTheme,
  isSafeExternalUrl,
  isWebviewMessage,
  normalizeReadingState,
  type EffectiveTheme,
  type HostToWebview,
  type PaperDataStore,
  type ReaderPrefs,
  type WebviewToHost,
} from "@labshelf/reader";

export type NoticeKind = "info" | "ok" | "error";

export interface ReaderHostLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(error: unknown, context?: Record<string, unknown>): void;
}

export interface ReaderHostDeps {
  paper: PaperRecord;
  store: PaperDataStore;
  /** Sends a message to the reader UI. */
  post(msg: HostToWebview): void;
  getPrefs(): ReaderPrefs;
  /** What "auto" resolves to right now (the LabShelf browser theme: system unless pinned). */
  autoTheme(): EffectiveTheme;
  writeClipboard(text: string): Promise<void>;
  notify(message: string, kind: NoticeKind): void;
  openExternal(url: string): Promise<void>;
  /** Offers a text file to the user (a download with a save dialog). */
  saveFile(fileName: string, text: string): Promise<void>;
  /** Asks the background to coalesce a Drive sync soon. */
  scheduleSync(reason: string): void;
  log: ReaderHostLogger;
  now?: () => number;
}

export class BrowserReaderHost {
  private themePreference: PdfTheme = "auto";
  private prefs: ReaderPrefs;
  private ready = false;
  private pendingPage: number | undefined;
  private currentPage = 1;
  private lastAnnotations = "";
  private readonly openedAt: number;

  constructor(private readonly deps: ReaderHostDeps, options: { page?: number } = {}) {
    this.prefs = deps.getPrefs();
    this.pendingPage = options.page;
    this.openedAt = (deps.now ?? Date.now)();
  }

  /** The page the reader last reported. */
  get page(): number { return this.currentPage; }

  /**
   * Entry point for every message the reader UI sends. Malformed messages are dropped and logged, never half-handled.
   * @usedBy reader/index (in-page transport)
   * @returns resolves once the message has been handled; failures become an error notice, never a rejection.
   */
  async handle(raw: unknown): Promise<void> {
    if (!isWebviewMessage(raw)) {
      this.deps.log.warn("Ignored malformed reader message", { paperId: this.deps.paper.id });
      return;
    }
    try {
      await this.dispatch(raw);
    } catch (err) {
      this.deps.log.error(err, { paperId: this.deps.paper.id, command: raw.command });
      this.deps.notify(`Reader action failed: ${errorText(err)}`, "error");
    }
  }

  /**
   * The LabShelf theme changed (system or the user's pin); papers set to "auto" follow it, like VS Code's colour theme.
   * @usedBy reader/index
   * @returns void
   */
  onAutoThemeChange(effective: EffectiveTheme): void {
    if (this.themePreference === "auto") {
      this.deps.post({ type: "applyTheme", theme: "auto", effectiveTheme: effective });
    }
  }

  /**
   * @usedBy reader/index (storage change from the options page)
   * @returns void
   */
  onPrefsChange(prefs: ReaderPrefs): void {
    this.prefs = prefs;
    this.deps.post({ type: "prefsChanged", prefs });
  }

  /**
   * Jumps to a page now if the document is laid out, or as soon as it is (the reader drops scrollToPage before that).
   * @usedBy reader/index (an already-open tab asked to show a page)
   * @returns void
   */
  requestPage(page: number): void {
    if (!Number.isInteger(page) || page < 1) return;
    if (this.ready) this.deps.post({ type: "scrollToPage", pageNumber: page });
    else this.pendingPage = page;
  }

  /**
   * Re-reads the sidecar and pushes the annotations if they changed, e.g. after a sync brought edits made in VS Code.
   * @usedBy reader/index (tab becomes visible again)
   * @returns void
   */
  async refreshAnnotations(): Promise<void> {
    if (!this.ready) return;
    await this.sendAnnotations(await this.deps.store.getAnnotations(this.deps.paper.id), false);
  }

  private async sendAnnotations(annotations: Annotation[], force: boolean): Promise<void> {
    const key = JSON.stringify(annotations);
    if (!force && key === this.lastAnnotations) return;
    this.lastAnnotations = key;
    this.deps.post({ type: "updateAnnotations", annotations });
  }

  private effective(theme: PdfTheme): EffectiveTheme {
    return theme === "auto" ? this.deps.autoTheme() : theme;
  }

  private async dispatch(msg: WebviewToHost): Promise<void> {
    const { paper, store } = this.deps;
    switch (msg.command) {
      case "ready-for-init": {
        const data = await store.load(paper.id);
        this.themePreference = data.theme;
        const annotations = [...data.annotations].sort(
          (a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt),
        );
        this.lastAnnotations = JSON.stringify(annotations);
        this.deps.post({
          type: "init",
          reading: data.reading ?? null,
          annotations,
          prefs: this.prefs,
          theme: data.theme,
          effectiveTheme: this.effective(data.theme),
        });
        break;
      }
      case "ready":
        this.ready = true;
        this.deps.log.info("Reader ready", { paperId: paper.id, totalPages: msg.totalPages });
        if (this.pendingPage) {
          this.deps.post({ type: "scrollToPage", pageNumber: this.pendingPage });
          this.pendingPage = undefined;
        }
        break;
      case "perf":
        // hostMs spans the whole open as the user feels it; timeline entries are ms since the page began loading.
        this.deps.log.info("PDF open timeline", {
          paperId: paper.id,
          hostMs: (this.deps.now ?? Date.now)() - this.openedAt,
          timeline: msg.timeline,
          theme: msg.theme,
          dpr: msg.dpr,
          canvas: msg.canvas,
        });
        break;
      case "pageChanged":
        this.currentPage = msg.pageNumber;
        break;
      case "zoomChanged":
        // Superseded by saveReadingState; accepted for protocol parity.
        break;
      case "selectTheme":
        if (isPdfTheme(msg.theme)) {
          this.themePreference = msg.theme;
          await store.setTheme(paper.id, msg.theme);
          this.deps.post({ type: "applyTheme", theme: msg.theme, effectiveTheme: this.effective(msg.theme) });
          this.deps.scheduleSync("reader.theme");
        }
        break;
      case "createAnnotation":
        try {
          if (msg.type === "highlight") {
            await store.addHighlight(paper.id, msg.pageNumber, msg.content, msg.color ?? "yellow", msg.position);
          } else {
            await store.addNote(paper.id, msg.pageNumber, msg.content);
          }
        } catch (err) {
          this.deps.notify(`Failed to create annotation: ${errorText(err)}`, "error");
          return;
        }
        await this.sendAnnotations(await store.getAnnotations(paper.id), true);
        this.deps.scheduleSync("reader.annotation");
        break;
      case "deleteAnnotation":
        try {
          await store.deleteAnnotation(paper.id, msg.id);
        } catch (err) {
          this.deps.notify(`Failed to delete annotation: ${errorText(err)}`, "error");
          return;
        }
        await this.sendAnnotations(await store.getAnnotations(paper.id), true);
        this.deps.scheduleSync("reader.annotation");
        break;
      case "updateAnnotation":
        try {
          await store.updateAnnotation(paper.id, msg.id, msg.content);
        } catch (err) {
          this.deps.notify(`Failed to update annotation: ${errorText(err)}`, "error");
          return;
        }
        await this.sendAnnotations(await store.getAnnotations(paper.id), true);
        this.deps.scheduleSync("reader.annotation");
        break;
      case "saveReadingState": {
        // Not a sync trigger: the position rides along with the next sync, as in VS Code.
        const state = normalizeReadingState(msg.state);
        if (state) await store.setReadingState(paper.id, state);
        break;
      }
      case "copyWithCitation": {
        const text = formatQuoteWithCitation(msg.text, paper, msg.pageNumber, this.prefs.citationStyle);
        await this.deps.writeClipboard(text);
        this.deps.notify(`Copied with citation (@${paper.citeKey}, p. ${msg.pageNumber})`, "ok");
        break;
      }
      case "copyText":
        await this.deps.writeClipboard(msg.text);
        this.deps.notify("Copied to clipboard", "ok");
        break;
      case "exportAnnotations": {
        const markdown = formatAnnotationsMarkdown(paper, await store.getAnnotations(paper.id));
        if (msg.target === "clipboard") {
          await this.deps.writeClipboard(markdown);
          this.deps.notify("Annotations copied as Markdown", "ok");
        } else {
          await this.deps.saveFile(`${paper.citeKey}-annotations.md`, markdown);
        }
        break;
      }
      case "openExternalLink":
        if (isSafeExternalUrl(msg.url)) {
          await this.deps.openExternal(msg.url);
        } else {
          this.deps.log.warn("Blocked external link with disallowed scheme", { paperId: paper.id });
        }
        break;
      default: {
        const unreachable: never = msg;
        void unreachable;
      }
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
