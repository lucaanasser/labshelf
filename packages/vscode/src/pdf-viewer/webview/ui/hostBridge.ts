/**
 * Typed wrapper over the VS Code webview messaging API.
 *
 * @depends pdf-viewer/shared/protocol.ts
 * @dependents pdf-viewer/webview/main.ts, pdf-viewer/webview/ui/*
 */
import type { HostToWebview, WebviewToHost } from "../../shared/protocol.js";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

type Handler<T extends HostToWebview["type"]> = (msg: Extract<HostToWebview, { type: T }>) => void;

export class HostBridge {
  private readonly api = acquireVsCodeApi();
  private readonly handlers = new Map<string, Array<(msg: HostToWebview) => void>>();

  constructor() {
    window.addEventListener("message", (ev: MessageEvent<unknown>) => {
      const msg = ev.data as HostToWebview | null;
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") { return; }
      for (const fn of this.handlers.get(msg.type) ?? []) { fn(msg); }
    });
  }

  /**
   * Sends a message to the extension host.
   * @usedBy pdf-viewer/webview/main.ts, pdf-viewer/webview/ui/*
   * @returns void
   */
  post(msg: WebviewToHost): void {
    this.api.postMessage(msg);
  }

  /**
   * Registers a handler invoked whenever the host sends a message of the given type.
   * @usedBy pdf-viewer/webview/main.ts, pdf-viewer/webview/ui/*
   * @returns void
   */
  on<T extends HostToWebview["type"]>(type: T, handler: Handler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as (msg: HostToWebview) => void);
    this.handlers.set(type, list);
  }
}
