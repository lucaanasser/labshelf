/**
 * Centralizes all extension events so producers and consumers remain decoupled.
 *
 * Uses an inline Map-based emitter rather than node:events so the bus is usable
 * inside the browser extension (service worker, content scripts, library page)
 * without polyfills.
 *
 * @depends events/events.ts
 * @dependents paperService, syncController, ui listeners, browser background
 */
import type { EventName } from "./events.js";

export type EventListener = (payload: unknown) => void;

export class ExtensionEventBus {
  private readonly listeners = new Map<EventName, Set<EventListener>>();

  /**
   * Broadcasts a named event with an arbitrary payload to all registered listeners.
   * @usedBy paperService, syncController, capture flows
   * @returns void
   */
  emit(eventName: EventName, payload: unknown): void {
    const set = this.listeners.get(eventName);
    if (!set) {
      return;
    }
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // Listener failures must not break sibling listeners or the emitter.
      }
    }
  }

  /**
   * Registers a listener for a named event.
   * @usedBy ui providers, browser views
   * @returns void
   */
  on(eventName: EventName, listener: EventListener): void {
    let set = this.listeners.get(eventName);
    if (!set) {
      set = new Set();
      this.listeners.set(eventName, set);
    }
    set.add(listener);
  }

  /**
   * Removes a previously registered listener.
   * @usedBy disposers, view teardown
   * @returns void
   */
  off(eventName: EventName, listener: EventListener): void {
    this.listeners.get(eventName)?.delete(listener);
  }
}
