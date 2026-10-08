/**
 * Entry point of the `labshelf` command: resolves the library, then either opens the TUI or runs a subcommand.
 * First run without a configured library asks for its folder (the one the VS Code extension uses) and remembers it in
 * the shared config file.
 *
 * Debug: `labshelf --dump-frame 120x40 [--keys "jj<enter>"]` prints one rendered frame as text, without a terminal.
 *
 * @depends app/*, cli/*, ui/app, tui/terminal
 * @dependents dist/labshelf.mjs (bin)
 */
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import { PAPERS_DIR, RESEARCH_DIR } from "@labshelf/core";

import { loadConfig, resolveLibraryRoot, updateConfig, configPath, type SharedConfig } from "./app/config.js";
import { openLibrary, type AppContext } from "./app/context.js";
import { parseArgs, stringFlag } from "./cli/args.js";
import { runDoctor, runLibraryCommand, USAGE, UsageError, type Output } from "./cli/commands.js";
import { ensureLibraryStructure, LibraryRoot, looksLikeLibrary } from "./library/index.js";
import { expandHome } from "./platform/dirs.js";
import { App, type TerminalLike } from "./ui/app.js";
import { InputDecoder } from "./tui/input.js";
import { sanitizeForTerminal } from "./tui/text.js";
import type { Screen } from "./tui/screen.js";
import { Terminal } from "./tui/terminal.js";

const VERSION = "0.1.0";
const DEFAULT_LIBRARY = "~/LabShelfLibrary";

// Everything the CLI prints may contain metadata from PDFs or other devices; control characters never pass through.
const io: Output = {
  out: (text) => process.stdout.write(sanitizeForTerminal(text.endsWith("\n") ? text : text + "\n")),
  err: (text) => process.stderr.write(sanitizeForTerminal(text.endsWith("\n") ? text : text + "\n")),
  columns: process.stdout.columns || 100,
};

async function adoptLibrary(raw: string): Promise<string> {
  const root = path.resolve(expandHome(raw));
  const existed = await looksLikeLibrary(root);
  await ensureLibraryStructure(new LibraryRoot(root));
  await updateConfig({ libraryRoot: root });
  io.err(existed ? `Using the library at ${root}` : `Created a new library at ${root}`);
  io.err(`Remembered in ${configPath()} (the VS Code extension reads it too).`);
  return root;
}

async function askForLibrary(): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    io.err("No LabShelf library is configured yet.");
    io.err(`If you use the VS Code extension, give the same folder (it contains ${PAPERS_DIR}/ and ${RESEARCH_DIR}/),`);
    io.err("so both apps — and Drive sync — work on one library.");
    const answer = (await rl.question(`Library folder [${DEFAULT_LIBRARY}]: `)).trim();
    return answer || DEFAULT_LIBRARY;
  } catch {
    return undefined;
  } finally {
    rl.close();
  }
}

async function resolveRoot(flag: string | undefined, config: SharedConfig, interactive: boolean): Promise<{ root: string; source: string } | undefined> {
  const resolution = resolveLibraryRoot(flag, process.env, config);
  if (resolution.root) {
    if (await looksLikeLibrary(resolution.root)) { return { root: resolution.root, source: resolution.source }; }
    io.err(`${resolution.root} is not a LabShelf library (no ${PAPERS_DIR}/ or ${RESEARCH_DIR}/ folder).`);
    if (resolution.source !== "config" || !interactive) {
      io.err("Run `labshelf init <path>` to create one there.");
      return undefined;
    }
  }
  if (!interactive) {
    io.err("No LabShelf library configured. Run `labshelf init <path>` or pass --library <path>.");
    return undefined;
  }
  const answer = await askForLibrary();
  return answer ? { root: await adoptLibrary(answer), source: "config" } : undefined;
}

// A terminal that renders into memory, for --dump-frame.
class MemoryTerminal implements TerminalLike {
  frame: Screen | undefined;
  constructor(private readonly cols: number, private readonly rows: number) {}
  size() { return { cols: this.cols, rows: this.rows }; }
  listen(): void { /* input comes from --keys */ }
  enter(): void { /* nothing to take over */ }
  leave(): void { /* nothing to restore */ }
  draw(frame: Screen): void { this.frame = frame; }
  invalidate(): void { /* no previous frame kept */ }
  writeRaw(): void { /* no images in text output */ }
  suspend<T>(run: () => T): T { return run(); }
  stopJob(): void { /* not a job */ }
}

// "jj<enter><C-d>" → key events, through the real decoder.
function keysToInput(spec: string): string {
  const names: Record<string, string> = {
    enter: "\r", esc: "\x1b", tab: "\t", space: " ", bs: "\x7f", up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D",
  };
  return spec.replace(/<([^>]+)>/g, (_, name: string) => {
    if (/^C-[a-z]$/.test(name)) { return String.fromCharCode(name.charCodeAt(2) - 96); }
    return names[name] ?? `<${name}>`;
  });
}

async function dumpFrame(ctx: AppContext, size: string, keys: string | undefined): Promise<void> {
  const [cols, rows] = size.split("x").map(Number);
  const term = new MemoryTerminal(cols || 120, rows || 36);
  const app = new App({ ...ctx, imageProtocol: "none" }, term);
  const decoder = new InputDecoder();
  // Let the async sidecar loads settle before the snapshot is taken.
  for (const event of [...decoder.feed(keysToInput(keys ?? "")), ...decoder.flush()]) {
    app.handle(event);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  // A frame starts the async loads (sidecars, thumbnails) the final frame shows.
  app.frame();
  await new Promise((resolve) => setTimeout(resolve, 80));
  io.out(app.frame().screen.toText());
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.flags["version"] === true) {
    io.out(VERSION);
    return 0;
  }
  if (args.flags["help"] === true || args.command === "help") {
    io.out(USAGE);
    return 0;
  }
  const config = await loadConfig();
  const libraryFlag = stringFlag(args.flags, "library");

  if (args.command === "init") {
    await adoptLibrary(args.positionals[0] ?? libraryFlag ?? config.libraryRoot ?? DEFAULT_LIBRARY);
    return 0;
  }
  if (args.command === "doctor") {
    const resolution = resolveLibraryRoot(libraryFlag, process.env, config);
    return runDoctor(resolution.root, resolution.source, config, io);
  }

  const tuiWanted = args.command === undefined && !args.flags["dump-frame"];
  if (tuiWanted && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    io.err("The explorer needs an interactive terminal. Use a subcommand instead (labshelf --help).");
    return 2;
  }
  const resolved = await resolveRoot(libraryFlag, config, Boolean(process.stdin.isTTY && process.stderr.isTTY));
  if (!resolved) { return 1; }
  if (args.command === "where") {
    const paths = new LibraryRoot(resolved.root);
    io.out(`library  ${paths.root}  (from ${resolved.source})`);
    io.out(`config   ${configPath()}`);
    io.out(`log      ${paths.layout.terminalLogPath()}`);
    io.out(`manifest ${paths.layout.manifestPath()}`);
    return 0;
  }

  const ctx = await openLibrary(resolved.root, {
    config: await loadConfig(),
    watch: tuiWanted,
    thumbnailWorkerUrl: new URL("./thumbnailWorker.mjs", import.meta.url),
  });
  try {
    const dump = stringFlag(args.flags, "dump-frame");
    if (dump) {
      await dumpFrame(ctx, dump, stringFlag(args.flags, "keys"));
      return 0;
    }
    if (tuiWanted) {
      const terminal = new Terminal();
      const app = new App(ctx, terminal);
      process.on("uncaughtException", (error) => {
        terminal.leave();
        void ctx.logger.error("terminal/main", error).finally(() => {
          io.err(`labshelf crashed: ${error.stack ?? error.message}`);
          process.exit(1);
        });
      });
      await app.run();
      return 0;
    }
    return await runLibraryCommand(ctx, args, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      return 2;
    }
    io.err(error instanceof Error ? error.message : String(error));
    await ctx.logger.error("terminal/cli", error);
    return 1;
  } finally {
    await ctx.dispose();
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    // Let stdout drain before exiting; open handles (watchers, timers) must not keep a finished command alive.
    process.stdout.write("", () => process.exit(code));
  },
  (error: unknown) => {
    io.err(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  },
);
