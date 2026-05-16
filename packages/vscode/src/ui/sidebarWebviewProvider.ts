/**
 * Module: Sidebar Webview Provider
 * Responsibility: Host the LabShelf sidebar UI and broker messages between
 *                 the webview and the existing services/commands.
 * Dependencies: vscode, core (PaperService, EventBus, Logger), state mapper, html template
 *
 * Architectural notes:
 * - The provider owns no domain logic. It maps PaperRecord[] into a view
 *   model, forwards user intents to existing commands/services, and pushes
 *   state back to the webview. Mock-only intents are logged explicitly so
 *   diagnostics can distinguish them from real flows.
 * - The provider subscribes to the event bus so any backend mutation
 *   (paper:added, paper:updated, paper:deleted) refreshes the sidebar
 *   without commands needing to call refresh() explicitly.
 */
import * as vscode from "vscode";

import { EVENTS } from "../constants/events.js";
import type { ExtensionEventBus } from "../core/eventBus.js";
import type { WorkspaceLogger } from "../core/logger.js";
import type { PaperService } from "../core/paperService.js";
import type { PaperStatus } from "../core/types.js";
import { mapPapersToViewModel } from "./sidebarStateMapper.js";
import { makeNonce, renderSidebarHtml } from "./sidebarHtml.js";

const LOG_MODULE = "ui/sidebarWebviewProvider";

const VALID_STATUSES: ReadonlySet<PaperStatus> = new Set(["unread", "reading", "done"]);

interface InboundMessage {
  type: string;
  payload?: Record<string, unknown>;
}

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "labshelf.sidebar";

  private view: vscode.WebviewView | undefined;
  private cachedHtml: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly paperService: PaperService,
    private readonly eventBus: ExtensionEventBus,
    private readonly logger: WorkspaceLogger,
  ) {
    eventBus.on(EVENTS.PAPER_ADDED, () => void this.pushState());
    eventBus.on(EVENTS.PAPER_UPDATED, () => void this.pushState());
    eventBus.on(EVENTS.PAPER_DELETED, () => void this.pushState());
  }

  refresh(): void {
    void this.pushState();
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message as InboundMessage);
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    await this.pushState();
  }

  private renderHtml(webview: vscode.Webview): string {
    if (this.cachedHtml) {
      return this.cachedHtml;
    }
    const nonce = makeNonce();
    this.cachedHtml = renderSidebarHtml(webview.cspSource, nonce);
    return this.cachedHtml;
  }

  private async handleMessage(message: InboundMessage): Promise<void> {
    if (!message || typeof message.type !== "string") {
      return;
    }

    try {
      switch (message.type) {
        case "ready":
          await this.pushState();
          return;
        case "refresh":
          await this.pushState();
          return;
        case "addPaper":
          await vscode.commands.executeCommand("labshelf.addPaper");
          return;
        case "addPaperFromUri":
          await this.handleAddFromUri(message.payload?.uris);
          return;
        case "regenerateBibtex":
          await vscode.commands.executeCommand("labshelf.generateBibTeX");
          return;
        case "openPdf":
          await this.handleOpenPdf(message.payload?.id);
          return;
        case "openFolder":
          await this.handleOpenFolder(message.payload?.id);
          return;
        case "copyCitation":
          await this.handleCopyCitation(message.payload?.id);
          return;
        case "updateStatus":
          await this.handleUpdateStatus(message.payload?.id, message.payload?.status);
          return;
        case "doiLookup":
          await this.logMock("doiLookup");
          await vscode.window.showInformationMessage("DOI/arXiv/ISBN lookup is not yet implemented.");
          return;
        case "editMetadata":
          await this.logMock("editMetadata", message.payload);
          await vscode.window.showInformationMessage("Metadata editing is not yet implemented.");
          return;
        case "dropFailed":
          await this.logger.log("WARN", LOG_MODULE, "Sidebar drop produced no usable URIs", { payload: message.payload });
          return;
        default:
          await this.logger.log("WARN", LOG_MODULE, "Unhandled sidebar message", { type: message.type });
      }
    } catch (error) {
      await this.logger.error(LOG_MODULE, error, { messageType: message.type });
      await this.postError(error);
    }
  }

  private async handleAddFromUri(rawUris: unknown): Promise<void> {
    const uris = Array.isArray(rawUris) ? rawUris.filter((value): value is string => typeof value === "string") : [];
    if (uris.length === 0) {
      return;
    }

    for (const raw of uris) {
      const target = this.parseFileUri(raw);
      if (!target) {
        await this.logger.log("WARN", LOG_MODULE, "Sidebar drop ignored non-file URI", { raw });
        continue;
      }
      if (!target.fsPath.toLowerCase().endsWith(".pdf")) {
        await this.logger.log("WARN", LOG_MODULE, "Sidebar drop ignored non-PDF file", { path: target.fsPath });
        continue;
      }
      await this.paperService.addPaperFromUri(target);
    }
  }

  private parseFileUri(raw: string): vscode.Uri | undefined {
    try {
      const parsed = vscode.Uri.parse(raw, true);
      if (parsed.scheme === "file") {
        return parsed;
      }
    } catch {
      // fall through to fs path heuristic
    }

    if (raw.startsWith("/") || /^[a-zA-Z]:\\/.test(raw)) {
      return vscode.Uri.file(raw);
    }

    return undefined;
  }

  private async handleOpenPdf(rawId: unknown): Promise<void> {
    const paper = await this.findPaper(rawId);
    if (!paper) {
      return;
    }
    const pdf = vscode.Uri.joinPath(vscode.Uri.file(paper.path), "paper.pdf");
    await vscode.commands.executeCommand("vscode.open", pdf);
  }

  private async handleOpenFolder(rawId: unknown): Promise<void> {
    const paper = await this.findPaper(rawId);
    if (!paper) {
      return;
    }
    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(paper.path));
  }

  private async handleCopyCitation(rawId: unknown): Promise<void> {
    const paper = await this.findPaper(rawId);
    if (!paper) {
      return;
    }
    await vscode.env.clipboard.writeText(paper.citeKey);
    vscode.window.setStatusBarMessage(`LabShelf: copied @${paper.citeKey}`, 2000);
  }

  private async handleUpdateStatus(rawId: unknown, rawStatus: unknown): Promise<void> {
    if (typeof rawId !== "string" || typeof rawStatus !== "string" || !VALID_STATUSES.has(rawStatus as PaperStatus)) {
      await this.logger.log("WARN", LOG_MODULE, "Invalid updateStatus payload", { rawId, rawStatus });
      return;
    }
    const updated = await this.paperService.updatePaperStatus(rawId, rawStatus as PaperStatus);
    if (!updated) {
      await this.logger.log("WARN", LOG_MODULE, "updateStatus referenced unknown paper", { rawId });
    }
  }

  private async findPaper(rawId: unknown): Promise<{ id: string; path: string; citeKey: string } | undefined> {
    if (typeof rawId !== "string") {
      return undefined;
    }
    const papers = await this.paperService.listPapers();
    const match = papers.find((paper) => paper.id === rawId);
    if (!match) {
      await this.logger.log("WARN", LOG_MODULE, "Sidebar referenced unknown paper", { rawId });
      return undefined;
    }
    return match;
  }

  private async pushState(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const papers = await this.paperService.listPapers();
      const viewModel = mapPapersToViewModel(papers);
      await this.view.webview.postMessage({ type: "setState", payload: viewModel });
    } catch (error) {
      await this.logger.error(LOG_MODULE, error, { stage: "pushState" });
      await this.postError(error);
    }
  }

  private async postError(error: unknown): Promise<void> {
    if (!this.view) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await this.view.webview.postMessage({ type: "setError", payload: { message } });
  }

  private async logMock(action: string, context?: Record<string, unknown> | undefined): Promise<void> {
    await this.logger.log("INFO", LOG_MODULE, `Mock-only sidebar action invoked: ${action}`, { action, ...(context ?? {}) });
  }
}
