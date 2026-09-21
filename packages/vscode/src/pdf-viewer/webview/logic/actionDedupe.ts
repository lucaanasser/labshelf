/**
 * One physical chord can reach the reader twice: through the webview's own keydown and through a contributed VS Code
 * keybinding that the host turns into a `command` message. Only the second delivery *from the other source* is a
 * duplicate; repeats from the same source are genuine (held key, repeated palette command) and must all run.
 *
 * @depends none
 * @dependents pdf-viewer/webview/ui/keyboard.ts
 */

export type ActionSource = "key" | "host";

export interface ActionStamp {
  action: string;
  source: ActionSource;
  at: number;
}

// Round trip webview → host keybinding resolution → extension host → webview; generous because it crosses two processes.
export const CROSS_SOURCE_WINDOW_MS = 250;

/**
 * @usedBy pdf-viewer/webview/ui/keyboard.ts
 * @returns true when `next` is the same chord arriving a second time through the other route.
 */
export function isDuplicateDelivery(last: ActionStamp | null, next: ActionStamp): boolean {
  if (!last) { return false; }
  return last.action === next.action
    && last.source !== next.source
    && next.at - last.at >= 0
    && next.at - last.at < CROSS_SOURCE_WINDOW_MS;
}
