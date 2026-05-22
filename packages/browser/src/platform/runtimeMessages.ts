/**
 * Discriminated message types exchanged between background and UI surfaces
 * (popup, options, library-page). Centralised so every send/receive site is
 * type-checked against the same envelope.
 * @depends none.
 * @dependents background/index, popup, options, library-page.
 */

export type RuntimeMessage =
  | { type: "ping" }
  | { type: "auth.status" }
  | { type: "auth.connect" }
  | { type: "auth.disconnect" }
  | { type: "sync.now" }
  | { type: "sync.status" }
  | { type: "capture.activeTab" };

export type RuntimeResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export interface SyncStatusData {
  connected: boolean;
  syncing: boolean;
  lastSyncTime: string | null;
  lastError: string | null;
}

export interface CaptureResultData {
  title: string;
  citeKey: string;
}

export const RUNTIME_CHANNEL = "labshelf.runtime";
