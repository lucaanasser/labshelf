/**
 * Watches the library on disk so changes made elsewhere — the VS Code extension, a sync run by either app, a file
 * manager — show up in the TUI within a fraction of a second. Uses recursive fs.watch (macOS, Windows, Linux on Node
 * 20+) and falls back to polling the papers folder when recursive watching is unavailable.
 */
import { watch, type FSWatcher } from "node:fs";

import type { ILogger } from "@labshelf/core";

import { LibraryRoot } from "./libraryRoot.js";

const DEBOUNCE_MS = 250;
const POLL_MS = 5_000;

// Our own atomic-write temp files and editor droppings are not library changes.
function isNoise(file: string | null): boolean {
  if (!file) { return false; }
  const base = file.split(/[\\/]/).pop() ?? "";
  return (base.startsWith(".") && base.endsWith(".tmp")) || base === ".DS_Store" || base.endsWith("~") || base.endsWith(".swp");
}

export class LibraryWatcher {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly paths: LibraryRoot,
    private readonly onChange: () => void,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Starts watching papers/ and the sidecar folder.
   * @returns void
   */
  start(): void {
    for (const dir of [this.paths.layout.papersRoot(), this.paths.layout.paperDataRoot()]) {
      try {
        const watcher = watch(dir, { recursive: true, persistent: false }, (_event, file) => {
          if (!isNoise(typeof file === "string" ? file : null)) { this.schedule(); }
        });
        watcher.on("error", (error) => {
          void this.logger?.log("WARN", "terminal/libraryWatcher", "Watcher failed, polling instead", { dir, message: String(error) });
          this.startPolling();
        });
        this.watchers.push(watcher);
      } catch (error) {
        void this.logger?.log("WARN", "terminal/libraryWatcher", "Recursive watch unavailable, polling instead", {
          dir, message: error instanceof Error ? error.message : String(error),
        });
        this.startPolling();
      }
    }
  }

  private startPolling(): void {
    if (this.poll) { return; }
    this.poll = setInterval(() => this.onChange(), POLL_MS);
    this.poll.unref?.();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(), DEBOUNCE_MS);
  }

  /**
   * @returns void
   */
  stop(): void {
    clearTimeout(this.timer);
    if (this.poll) { clearInterval(this.poll); }
    for (const watcher of this.watchers) { watcher.close(); }
    this.watchers = [];
  }
}
