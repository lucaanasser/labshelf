/**
 * Barrel re-export for event bus and event name constants.
 *
 * @depends events.ts, eventBus.ts
 * @dependents @labshelf/core index, downstream packages
 */
export { EVENTS } from "./events.js";
export type { EventName } from "./events.js";
export { EventBus } from "./eventBus.js";
export type { EventListener } from "./eventBus.js";
