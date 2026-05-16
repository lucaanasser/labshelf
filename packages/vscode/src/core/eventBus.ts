/**
 * Centralizes all extension events so producers and consumers remain decoupled.
 *
 * @depends constants/events
 * @dependents core/paperService.ts, extension.ts, pdf-viewer/AnnotationManager.ts, pdf-viewer/PdfViewerPanel.ts, sync/adapter/syncController.ts, ui/library/libraryTreeDataProvider.ts, ui/list/listWebviewPanel.ts
 */
import { EventEmitter } from "node:events";

import type { EventName } from "../constants/events.js";

export class ExtensionEventBus {
  /**
   * Broadcasts a named event with an arbitrary payload to all registered listeners.
   * @usedBy core/paperService.ts, pdf-viewer/AnnotationManager.ts, pdf-viewer/PdfViewerPanel.ts, sync/adapter/syncController.ts
   * @returns void
   */
  emit(eventName: EventName, payload: unknown): void {
    this.emitter.emit(eventName, payload);
  }

  /**
   * Registers a listener for a named event.
   * @usedBy extension.ts, ui/library/libraryTreeDataProvider.ts, ui/list/listWebviewPanel.ts
   * @returns void
   */
  on(eventName: EventName, listener: (payload: unknown) => void): void {
    this.emitter.on(eventName, listener);
  }

  private readonly emitter = new EventEmitter();
}