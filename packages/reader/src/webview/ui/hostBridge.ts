/**
 * Typed wrapper over the reader's host transport. The UI only ever talks to HostBridge; which host is on the other
 * side (the VS Code extension host, or the browser extension's in-page host) is decided by the transport the entry
 * point hands in.
 *
 * @depends shared/protocol.ts
 * @dependents webview/reader.ts, webview/main.ts, webview/ui/*, browser reader/index.ts
 */
import type { HostToWebview, WebviewToHost } from "../../shared/protocol.js";

/** How messages travel between the reader UI and its host. */
export interface ReaderTransport {
  /** Hands one message to the host; must never throw into UI code. */
  post(msg: WebviewToHost): void;
  /** Installs the single sink for host messages; HostBridge calls it once and validates each message's shape. */
  listen(sink: (msg: unknown) => void): void;
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/**
 * acquireVsCodeApi() may be called once per webview document; host messages arrive as window "message" events.
 * @usedBy webview/main.ts
 * @returns the VS Code webview transport.
 */
export function createVsCodeTransport(): ReaderTransport {
  const api = acquireVsCodeApi();
  return {
    post: (msg) => api.postMessage(msg),
    listen: (sink) => window.addEventListener("message", (ev: MessageEvent<unknown>) => sink(ev.data)),
  };
}

type Handler<T extends HostToWebview["type"]> = (msg: Extract<HostToWebview, { type: T }>) => void;

export class HostBridge {
  private readonly handlers = new Map<string, Array<(msg: HostToWebview) => void>>();

  constructor(private readonly transport: ReaderTransport) {
    transport.listen((raw) => {
      const msg = raw as HostToWebview | null;
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") { return; }
      for (const fn of this.handlers.get(msg.type) ?? []) { fn(msg); }
    });
  }

  /**
   * Sends a message to the host.
   * @usedBy webview/reader.ts, webview/ui/*
   * @returns void
   */
  post(msg: WebviewToHost): void {
    this.transport.post(msg);
  }

  /**
   * Registers a handler invoked whenever the host sends a message of the given type.
   * @usedBy webview/reader.ts, webview/ui/*
   * @returns void
   */
  on<T extends HostToWebview["type"]>(type: T, handler: Handler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as (msg: HostToWebview) => void);
    this.handlers.set(type, list);
  }
}
