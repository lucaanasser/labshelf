/** Reader transport over the VS Code webview messaging API. */
import type { ReaderTransport } from "@labshelf/core/dom";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/**
 * acquireVsCodeApi() may be called once per webview document; host messages arrive as window "message" events.
 * @returns the VS Code webview transport.
 */
export function createVsCodeTransport(): ReaderTransport {
  const api = acquireVsCodeApi();
  return {
    post: (msg) => api.postMessage(msg),
    listen: (sink) => window.addEventListener("message", (ev: MessageEvent<unknown>) => sink(ev.data)),
  };
}
