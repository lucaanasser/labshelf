/**
 * Turns keydown events into reader actions via the pure keymap, and drives held-key scrolling with a rAF loop (key-repeat + smooth scrolling stutters).
 */
import {
  isDuplicateDelivery,
  type ActionSource,
  type ActionStamp,
  ACTIONS_BLOCKED_WHILE_TYPING,
  CHORD_TIMEOUT_MS,
  resolveKey,
  type ReaderAction,
} from "../../logic/index.js";
import type { ReaderContext } from "./context.js";
import { isTextInput } from "./dom.js";

const SCROLL_PX_PER_SEC = 900;
const SCROLL_ACTIONS: Partial<Record<ReaderAction, [number, number]>> = {
  scrollDown: [0, 1],
  scrollUp: [0, -1],
  scrollLeft: [-1, 0],
  scrollRight: [1, 0],
};
const NATIVE_IN_CHROME: ReadonlySet<ReaderAction> = new Set<ReaderAction>([
  "scrollDown", "scrollUp", "scrollLeft", "scrollRight", "pageDown", "pageUp", "firstPage", "lastPage", "nextPage", "prevPage",
]);

export class Keyboard {
  private pendingPrefix: string | null = null;
  private prefixTimer: ReturnType<typeof setTimeout> | null = null;
  private held: { key: string; dir: [number, number] } | null = null;
  private frame: number | null = null;
  private lastFrameTime = 0;
  private lastRun: ActionStamp | null = null;

  constructor(private readonly ctx: ReaderContext, private readonly run: (action: ReaderAction) => void) {
    document.addEventListener("keydown", (e) => this.onKeyDown(e));
    document.addEventListener("keyup", (e) => { if (this.held?.key === e.key) { this.stopScroll(); } });
    window.addEventListener("blur", () => this.stopScroll());
  }

  /**
   * Runs an action unless it is the same chord arriving a second time through the other route (keydown vs. host keybinding).
   * @returns void
   */
  dispatch(action: ReaderAction, source: ActionSource): void {
    // A contributed keybinding fires no matter where the focus is inside the webview; keydown already applies this rule in resolveKey.
    if (source === "host" && ACTIONS_BLOCKED_WHILE_TYPING.has(action) && isTextInput(document.activeElement)) { return; }
    const stamp: ActionStamp = { action, source, at: performance.now() };
    if (isDuplicateDelivery(this.lastRun, stamp)) { return; }
    this.lastRun = stamp;
    this.run(action);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing) { return; }
    const { action, pendingPrefix } = resolveKey(
      { key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey },
      {
        vimKeys: this.ctx.prefs.vimKeys,
        isMac: this.ctx.boot.isMac,
        inTextInput: isTextInput(e.target),
        pendingPrefix: this.pendingPrefix,
      },
    );
    this.setPrefix(pendingPrefix);
    if (pendingPrefix !== null) { e.preventDefault(); return; }
    if (!action) { return; }
    const target = e.target instanceof HTMLElement ? e.target : null;
    // Space/Enter on a focused control activates it; scroll keys inside the sidebar or a menu scroll that list.
    const onControl = target?.closest("button, a, [role=button], [role=treeitem]") !== null && target !== null;
    if (onControl && (e.key === " " || e.key === "Enter")) { return; }
    const inChrome = target?.closest("#sidebar, .rd-popover") != null;
    if (inChrome && NATIVE_IN_CHROME.has(action)) { return; }
    // Escape must still reach inputs and native handlers when nothing of ours is open; main decides.
    if (action !== "escape") { e.preventDefault(); }

    const dir = SCROLL_ACTIONS[action];
    if (dir) {
      if (!e.repeat) { this.startScroll(e.key, dir); }
      return;
    }
    this.dispatch(action, "key");
  }

  private setPrefix(prefix: string | null): void {
    if (this.prefixTimer) { clearTimeout(this.prefixTimer); this.prefixTimer = null; }
    this.pendingPrefix = prefix;
    if (prefix !== null) {
      this.prefixTimer = setTimeout(() => { this.pendingPrefix = null; }, CHORD_TIMEOUT_MS);
    }
  }

  private startScroll(key: string, dir: [number, number]): void {
    this.held = { key, dir };
    // A tap still moves a useful amount even if the key is released before the first frame.
    this.ctx.container.scrollBy({ left: dir[0] * 40, top: dir[1] * 40 });
    if (this.frame !== null) { return; }
    this.lastFrameTime = performance.now();
    const tick = (now: number): void => {
      if (!this.held) { this.frame = null; return; }
      const dt = Math.min(64, now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      const [dx, dy] = this.held.dir;
      this.ctx.container.scrollBy({ left: dx * SCROLL_PX_PER_SEC * dt, top: dy * SCROLL_PX_PER_SEC * dt });
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopScroll(): void {
    this.held = null;
    if (this.frame !== null) { cancelAnimationFrame(this.frame); this.frame = null; }
  }
}
