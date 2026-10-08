/**
 * The reader transport for an extension page, where the host runs in the same document as the reader UI. Messages are
 * structured-cloned and delivered asynchronously in both directions, as across a VS Code webview boundary, so the UI
 * sees the same ordering and never shares objects with the host.
 *
 * @depends @labshelf/reader (ReaderTransport type, protocol types)
 * @dependents reader/index
 */
import type { HostToWebview, WebviewToHost } from "@labshelf/reader";
import type { ReaderTransport } from "@labshelf/reader/src/webview/ui/hostBridge";

export interface InPageChannel {
  /** Handed to startReader. */
  transport: ReaderTransport;
  /** Host side: sends a message to the reader UI (buffered until the UI listens). */
  send(msg: HostToWebview): void;
}

/**
 * @usedBy reader/index
 * @returns a transport whose posts reach `onMessage`, plus the function the host uses to answer.
 */
export function createInPageChannel(onMessage: (msg: WebviewToHost) => void): InPageChannel {
  let sink: ((msg: unknown) => void) | null = null;
  const backlog: HostToWebview[] = [];
  const deliver = (msg: HostToWebview): void => {
    const copy = structuredClone(msg);
    setTimeout(() => sink?.(copy), 0);
  };
  return {
    transport: {
      post(msg) {
        const copy = structuredClone(msg);
        setTimeout(() => onMessage(copy), 0);
      },
      listen(fn) {
        sink = fn;
        for (const msg of backlog.splice(0)) deliver(msg);
      },
    },
    send(msg) {
      if (sink) deliver(msg);
      else backlog.push(msg);
    },
  };
}
