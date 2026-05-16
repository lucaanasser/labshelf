/**
 * Module: Event Bus
 * Responsibility: Centralize extension events and listeners
 * Dependencies: node:events
 */
import { EventEmitter } from "node:events";

import type { EventName } from "../constants/events.js";

export class ExtensionEventBus {
  private readonly emitter = new EventEmitter();

  emit(eventName: EventName, payload: unknown): void {
    this.emitter.emit(eventName, payload);
  }

  on(eventName: EventName, listener: (payload: unknown) => void): void {
    this.emitter.on(eventName, listener);
  }
}