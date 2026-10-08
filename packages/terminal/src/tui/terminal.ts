/**
 * Owns the real terminal while the TUI runs: raw mode, the alternate screen, mouse and bracketed paste, resize and
 * input events, frame output wrapped in synchronized-update markers, and restoring everything on exit, crash, Ctrl-Z
 * and when handing the terminal to $EDITOR.
 *
 * @depends tui/input, tui/screen
 * @dependents ui/app, main
 */
import type { ReadStream, WriteStream } from "node:tty";

import { InputDecoder, type InputEvent } from "./input.js";
import type { Screen } from "./screen.js";

const ENTER = "\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[H\x1b[2J";
const LEAVE = "\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?2004l\x1b[?7h\x1b[0m\x1b[?25h\x1b[?1049l";
const SYNC_BEGIN = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";
const ESC_TIMEOUT_MS = 30;

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** The terminal the TUI draws on. */
export class Terminal {
  private readonly decoder = new InputDecoder();
  private active = false;
  private escTimer: ReturnType<typeof setTimeout> | undefined;
  private previous: Screen | undefined;
  private readonly onData = (chunk: Buffer | string): void => this.handleData(chunk.toString());
  private readonly onResize = (): void => {
    this.previous = undefined;
    this.resizeListener?.(this.size());
  };
  private readonly onSigcont = (): void => {
    this.enter();
    this.resizeListener?.(this.size());
  };
  private inputListener: ((event: InputEvent) => void) | undefined;
  private resizeListener: ((size: TerminalSize) => void) | undefined;
  private readonly restoreOnExit = (): void => this.leave();
  // Node's default SIGTERM/SIGHUP handling exits without "exit" listeners, which would leave the shell in the
  // alternate screen with mouse reporting on.
  private readonly onTerminate = (signal: NodeJS.Signals): void => {
    this.leave();
    process.exit(signal === "SIGHUP" ? 129 : 143);
  };

  constructor(
    private readonly input: ReadStream = process.stdin as ReadStream,
    private readonly output: WriteStream = process.stdout as WriteStream,
  ) {}

  /** @returns the current size in cells */
  size(): TerminalSize {
    return { cols: this.output.columns || 80, rows: this.output.rows || 24 };
  }

  /**
   * Starts listening for input and resizes.
   * @usedBy ui/app
   * @returns void
   */
  listen(onInput: (event: InputEvent) => void, onResize: (size: TerminalSize) => void): void {
    this.inputListener = onInput;
    this.resizeListener = onResize;
  }

  /**
   * Switches to the alternate screen in raw mode.
   * @usedBy ui/app, suspend
   * @returns void
   */
  enter(): void {
    if (this.active) { return; }
    this.active = true;
    this.input.setRawMode?.(true);
    this.input.setEncoding("utf8");
    this.input.on("data", this.onData);
    this.input.resume();
    this.output.on("resize", this.onResize);
    process.on("SIGCONT", this.onSigcont);
    process.on("exit", this.restoreOnExit);
    process.on("SIGTERM", this.onTerminate);
    process.on("SIGHUP", this.onTerminate);
    this.output.write(ENTER);
    this.previous = undefined;
  }

  /**
   * Restores the terminal exactly as it was found.
   * @usedBy ui/app (quit), suspend, process exit handler
   * @returns void
   */
  leave(): void {
    if (!this.active) { return; }
    this.active = false;
    clearTimeout(this.escTimer);
    this.input.off("data", this.onData);
    this.output.off("resize", this.onResize);
    process.off("SIGCONT", this.onSigcont);
    process.off("exit", this.restoreOnExit);
    process.off("SIGTERM", this.onTerminate);
    process.off("SIGHUP", this.onTerminate);
    this.output.write(LEAVE);
    this.input.setRawMode?.(false);
    this.input.pause();
  }

  /**
   * Hands the terminal to another program (an editor) and takes it back afterwards.
   * @usedBy ui/app (note editing)
   * @returns what run returned
   */
  suspend<T>(run: () => T): T {
    this.leave();
    try {
      return run();
    } finally {
      this.enter();
      // The window may have been resized while the editor had it.
      this.resizeListener?.(this.size());
    }
  }

  /**
   * Stops the process like a shell job (Ctrl-Z); SIGCONT brings the TUI back.
   * @usedBy ui/app
   * @returns void
   */
  stopJob(): void {
    this.leave();
    process.once("SIGCONT", this.onSigcont);
    process.kill(process.pid, "SIGTSTP");
  }

  /**
   * Writes one frame (only the cells that changed) plus any raw extra output such as image escapes.
   * @usedBy ui/app render loop
   * @returns void
   */
  draw(frame: Screen, extra = ""): void {
    if (!this.active) { return; }
    const body = frame.diff(this.previous);
    this.previous = frame;
    if (body || extra) {
      this.output.write(SYNC_BEGIN + body + extra + SYNC_END);
    }
  }

  /**
   * Forgets the last frame so the next draw repaints every cell (after an image was removed, or an editor ran).
   * @usedBy ui/app
   * @returns void
   */
  invalidate(): void {
    this.previous = undefined;
  }

  /**
   * Writes raw bytes (image protocol escapes) outside of a frame.
   * @usedBy ui/app
   * @returns void
   */
  writeRaw(data: string): void {
    if (this.active && data) { this.output.write(data); }
  }

  private handleData(chunk: string): void {
    clearTimeout(this.escTimer);
    for (const event of this.decoder.feed(chunk)) { this.inputListener?.(event); }
    if (this.decoder.hasPending()) {
      this.escTimer = setTimeout(() => {
        for (const event of this.decoder.flush()) { this.inputListener?.(event); }
      }, ESC_TIMEOUT_MS);
    }
  }
}
