/**
 * Centralizes extension event name constants used across the event bus.
 *
 * @depends none
 * @dependents events/eventBus.ts, paperService, annotationManager, pdfViewerPanel, syncController, browser background
 */
export const EVENTS = {
  PAPER_ADDED: "paper:added",
  PAPER_UPDATED: "paper:updated",
  PAPER_DELETED: "paper:deleted",
  NOTE_CREATED: "note:created",
  CITATION_INSERTED: "citation:inserted",
  PDF_VIEWER_OPENED: "pdf:viewer:opened",
  PDF_VIEWER_CLOSED: "pdf:viewer:closed",
  ANNOTATION_CREATED: "annotation:created",
  ANNOTATION_UPDATED: "annotation:updated",
  ANNOTATION_DELETED: "annotation:deleted",
  PAPER_THEME_CHANGED: "paper:theme:changed",
  VSCODE_THEME_CHANGED: "vscode:theme:changed",
  AI_INDEX_STARTED: "ai:index:started",
  AI_INDEXED: "ai:indexed",
  AI_INDEX_FAILED: "ai:index:failed",
  AI_MODEL_READY: "ai:model:ready",
  AI_MODEL_FAILED: "ai:model:failed",
  READING_EVENT: "reading:event",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
