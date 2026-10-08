/**
 * Non-interactive subcommands of `labshelf`, for scripts, shell pipelines (fzf, rg) and quick lookups. Each command
 * opens the library through the same composition root as the TUI and writes plain text or --json to stdout;
 * diagnostics go to stderr. Exit codes: 0 ok, 1 failure, 2 usage error.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { libraryLayout, paperFiles, type PaperRecord, type PaperStatus } from "@labshelf/core";
import { sharedConfigDir, sharedConfigPath } from "@labshelf/core/node";

import type { TerminalConfig } from "../app/config.js";
import type { AppContext } from "../app/context.js";
import { papersUnder, type PaperEntry, paperComparator, type SortSpec } from "../library/index.js";
import { copyToClipboard, hasCommand, openExternal } from "../platform/system.js";
import { resolveOAuthClient } from "../sync/driveAuth.js";
import { createTokenStore } from "../sync/tokenStore.js";
import { detectImageProtocol } from "../tui/graphics.js";
import { fit, stringWidth } from "../tui/text.js";
import { formatBytes, paperLink, relativeTime, venueLine } from "../ui/format.js";
import { STATUS_GLYPH } from "../ui/theme.js";
import { stringFlag, type ParsedArgs } from "./args.js";

export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
  columns: number;
}

export class UsageError extends Error {}

const STATUS_WORDS: Record<string, PaperStatus> = { unread: "unread", u: "unread", reading: "reading", r: "reading", done: "done", d: "done" };

export const USAGE = `LabShelf in the terminal — a paper explorer over your LabShelf library.

Usage:
  labshelf                         open the explorer (TUI)
  labshelf <command> [options]

Library:
  ls [collection] [-r] [--json]    list a collection (-r: everything below it)
  search <query…> [--json]         search the library (tag:x status:reading year:2015..2020 author:x has:pdf)
  show <id> [--json]               details, highlights and reading position of a paper
  add <pdf|folder|url|doi|arxiv>…  import papers [--to <collection>]
  bib [id…] [-c <collection>]      print BibTeX [-o file.bib]
  open <id>                        open the PDF
  status <id…> <unread|reading|done>
  tag <id…> +tag -tag              add / remove tags
  mv <id…> <collection>            move papers to a collection

Sync (Google Drive, shared with the VS Code extension):
  sync                             sync now
  auth login | logout | status     sign in to Google Drive

Setup:
  init [path]                      create or adopt a library and remember it
  where                            print the library, config and log paths
  doctor                           check the setup

Options:
  -L, --library <path>             use this library (else LABSHELF_LIBRARY, else ~/.config/labshelf/config.json)
  --json                           machine-readable output
  -h, --help, -v, --version
`;

function sortSpec(flags: ParsedArgs["flags"], config: TerminalConfig): SortSpec {
  const raw = stringFlag(flags, "sort") ?? config.terminal?.sort ?? "title";
  const reverse = raw.endsWith("!") || flags["reverse"] === true;
  const key = raw.replace(/!$/, "");
  return { key: (["title", "year", "author", "status", "modified"].includes(key) ? key : "title") as SortSpec["key"], reverse };
}

function asJson(entry: PaperEntry): Record<string, unknown> {
  return { ...entry.record, collection: entry.collection, pdfBytes: entry.pdfBytes ?? null };
}

function table(entries: PaperEntry[], columns: number): string {
  const idWidth = Math.min(28, Math.max(4, ...entries.map((e) => stringWidth(e.record.id))));
  const titleWidth = Math.max(20, columns - idWidth - 12);
  return entries.map((e) => {
    const r = e.record;
    return `${STATUS_GLYPH[r.status]} ${String(r.year ?? "").padEnd(4)}  ${fit(r.id, idWidth)}  ${fit(r.title, titleWidth).trimEnd()}`;
  }).join("\n");
}

function requirePaper(ctx: AppContext, id: string): PaperEntry {
  const entry = ctx.store.paper(id) ?? [...ctx.store.snapshot.papers.values()].find((e) => e.record.citeKey === id);
  if (!entry) { throw new UsageError(`No paper with id "${id}"`); }
  return entry;
}

function requireCollection(ctx: AppContext, raw: string | undefined): string {
  const rel = (raw ?? "").replace(/^papers\/?/, "").replace(/^\/+|\/+$/g, "");
  if (!ctx.store.collection(rel)) { throw new UsageError(`No collection "${raw}"`); }
  return rel;
}

/**
 * Runs one library command.
 * @returns the exit code
 */
export async function runLibraryCommand(ctx: AppContext, args: ParsedArgs, io: Output): Promise<number> {
  const { command, positionals, flags } = args;
  const json = flags["json"] === true;
  const sort = sortSpec(flags, ctx.config);
  switch (command) {
    case "ls": case "list": {
      const rel = requireCollection(ctx, positionals[0]);
      if (flags["recursive"] === true || flags["all"] === true) {
        const papers = papersUnder(ctx.store.snapshot, rel).sort(paperComparator(sort));
        io.out(json ? JSON.stringify(papers.map(asJson), null, 2) : table(papers, io.columns));
        return 0;
      }
      const entries = ctx.store.listCollection(rel, { sort });
      if (json) {
        io.out(JSON.stringify(entries.map((e) => (e.kind === "paper"
          ? { kind: "paper", ...asJson(e.paper) }
          : { kind: "collection", path: e.node.rel, name: e.node.name, papers: e.node.total })), null, 2));
        return 0;
      }
      const lines = entries.filter((e) => e.kind === "collection").map((e) => (e.kind === "collection" ? `  ${e.node.name}/ (${e.node.total})` : ""));
      const papers = entries.flatMap((e) => (e.kind === "paper" ? [e.paper] : []));
      io.out([...lines, papers.length ? table(papers, io.columns) : ""].filter(Boolean).join("\n") || "(empty)");
      return 0;
    }
    case "search": case "find": {
      // Highlights are indexed in the background; a one-shot search must not run before they are in.
      await ctx.annotationsReady;
      const query = positionals.join(" ");
      const results = ctx.store.search(query, sort);
      io.out(json ? JSON.stringify(results.map(asJson), null, 2) : results.length ? table(results, io.columns) : "No match.");
      return results.length ? 0 : 1;
    }
    case "show": {
      const entry = requirePaper(ctx, positionals[0] ?? "");
      const data = await ctx.sidecars.load(entry.record.id);
      if (json) {
        io.out(JSON.stringify({ ...asJson(entry), annotations: data.annotations, reading: data.reading ?? null }, null, 2));
        return 0;
      }
      io.out(showText(entry, data.annotations.length, data.reading?.page));
      return 0;
    }
    case "add": case "import": {
      if (!positionals.length) { throw new UsageError("add needs at least one PDF, folder, URL, DOI or arXiv id"); }
      const target = requireCollection(ctx, stringFlag(flags, "to"));
      const outcomes = await ctx.papers.importAny(positionals, target, (p) => io.err(`[${p.index}/${p.total}] ${p.input}`));
      let failed = 0;
      for (const outcome of outcomes) {
        if (outcome.status === "added") {
          io.out(`added  ${outcome.paper.id}  ${outcome.paper.title}${outcome.needsReview ? "  (metadata unconfirmed)" : ""}`);
        } else if (outcome.status === "duplicate") {
          io.out(`exists ${outcome.existingId}  (${outcome.input})`);
        } else {
          failed++;
          io.err(`failed ${outcome.input}: ${outcome.error}`);
        }
      }
      return failed ? 1 : 0;
    }
    case "bib": case "bibtex": {
      let records: PaperRecord[];
      if (positionals.length) {
        records = positionals.map((id) => requirePaper(ctx, id).record);
      } else {
        records = papersUnder(ctx.store.snapshot, requireCollection(ctx, stringFlag(flags, "collection"))).sort(paperComparator(sort)).map((e) => e.record);
      }
      const text = ctx.papers.bibtexFor(records);
      const output = stringFlag(flags, "output");
      if (output) {
        await fs.writeFile(path.resolve(output), text);
        io.err(`${records.length} entries written to ${path.resolve(output)}`);
      } else {
        io.out(text.trimEnd());
      }
      return 0;
    }
    case "open": {
      const entry = requirePaper(ctx, positionals[0] ?? "");
      if (entry.record.hasPdf === false) {
        const link = paperLink(entry.record);
        io.err(`No PDF on this device for ${entry.record.id}${link ? ` (${link})` : ""}`);
        return 1;
      }
      openExternal(paperFiles(entry.record.path, path.join).pdf, process.env["LABSHELF_PDF_VIEWER"] || ctx.config.terminal?.pdfViewer);
      return 0;
    }
    case "status": {
      const word = positionals[positionals.length - 1] ?? "";
      const status = STATUS_WORDS[word.toLowerCase()];
      if (!status || positionals.length < 2) { throw new UsageError("Usage: labshelf status <id…> <unread|reading|done>"); }
      const ids = positionals.slice(0, -1).map((id) => requirePaper(ctx, id).record.id);
      const outcome = await ctx.papers.setStatus(ids, status);
      for (const failure of outcome.failed) { io.err(`${failure.id}: ${failure.error}`); }
      return outcome.failed.length ? 1 : 0;
    }
    case "tag": case "tags": {
      const ids: string[] = [];
      const add: string[] = [];
      const remove: string[] = [];
      for (const token of positionals) {
        if (token.startsWith("+")) { add.push(token.slice(1)); } else if (token.startsWith("-")) { remove.push(token.slice(1)); } else { ids.push(requirePaper(ctx, token).record.id); }
      }
      if (!ids.length || (!add.length && !remove.length)) { throw new UsageError("Usage: labshelf tag <id…> +tag -tag"); }
      const outcome = await ctx.papers.editTags(ids, add, remove);
      for (const failure of outcome.failed) { io.err(`${failure.id}: ${failure.error}`); }
      return outcome.failed.length ? 1 : 0;
    }
    case "mv": case "move": {
      if (positionals.length < 2) { throw new UsageError("Usage: labshelf mv <id…> <collection>"); }
      const target = requireCollection(ctx, positionals[positionals.length - 1]);
      const ids = positionals.slice(0, -1).map((id) => requirePaper(ctx, id).record.id);
      const outcome = await ctx.papers.movePapers(ids, target);
      for (const failure of outcome.failed) { io.err(`${failure.id}: ${failure.error}`); }
      return outcome.failed.length ? 1 : 0;
    }
    case "copy": {
      const entry = requirePaper(ctx, positionals[0] ?? "");
      await copyToClipboard(entry.record.citeKey);
      return 0;
    }
    case "sync": return runSync(ctx, io, json);
    case "auth": return runAuth(ctx, positionals[0], io);
    default:
      throw new UsageError(`Unknown command "${command}". Run labshelf --help.`);
  }
}

function showText(entry: PaperEntry, highlights: number, page: number | undefined): string {
  const r = entry.record;
  const lines = [r.title];
  if (r.authors?.length) { lines.push(r.authors.join(", ")); }
  const venue = venueLine(r);
  if (venue) { lines.push(venue); }
  lines.push("");
  const rows: Array<[string, string | undefined]> = [
    ["id", r.id],
    ["status", `${STATUS_GLYPH[r.status]} ${r.status}`],
    ["tags", r.tags?.join(", ")],
    ["doi", r.doi],
    ["url", r.url],
    ["in", entry.collection || "(library root)"],
    ["pdf", r.hasPdf === false ? "not on this device" : `${paperFiles(r.path, path.join).pdf} (${formatBytes(entry.pdfBytes ?? 0)})`],
    ["notes", highlights ? `${highlights} highlight(s)` : undefined],
    ["read", page ? `stopped at page ${page}` : undefined],
  ];
  for (const [label, value] of rows) { if (value) { lines.push(`${label.padEnd(7)}${value}`); } }
  if (r.note?.trim()) { lines.push("", "note:", r.note.trim()); }
  if (r.summary?.trim()) { lines.push("", r.summary.trim()); }
  return lines.join("\n");
}

async function runSync(ctx: AppContext, io: Output, json: boolean): Promise<number> {
  const outcome = await ctx.sync.syncNow("cli");
  if (json) {
    io.out(JSON.stringify(outcome.kind === "synced" ? { kind: "synced", ...outcome.record } : outcome, null, 2));
  } else if (outcome.kind === "synced") {
    const r = outcome.record;
    io.out(`synced: ${r.downloaded} downloaded, ${r.uploaded} uploaded, ${r.deletedLocal} removed here, ${r.deletedRemote} removed on Drive`);
    for (const conflict of r.conflicts) { io.err(`conflict: ${conflict} (both versions kept)`); }
  } else if (outcome.kind === "busy") {
    io.err(`${outcome.holder?.app === "vscode" ? "VS Code" : "Another LabShelf app"} is syncing this library right now.`);
  } else if (outcome.kind === "skipped") {
    io.err(`sync skipped: ${outcome.reason}${outcome.reason.includes("signed in") ? " — run `labshelf auth login`" : ""}`);
  } else {
    io.err(`sync failed: ${outcome.error}`);
  }
  return outcome.kind === "synced" ? 0 : 1;
}

async function runAuth(ctx: AppContext, sub: string | undefined, io: Output): Promise<number> {
  if (sub === "login") {
    await ctx.sync.login({
      openBrowser: (url) => openExternal(url),
      onUrl: (url) => io.err(`Opening Google sign-in in your browser. If nothing opens, visit:\n\n  ${url}\n`),
    });
    io.out("Signed in to Google Drive.");
    return 0;
  }
  if (sub === "logout") {
    await ctx.sync.logout();
    io.out("Signed out. The library stays on this computer.");
    return 0;
  }
  if (sub === "status" || sub === undefined) {
    const status = ctx.sync.status();
    io.out(`drive:     ${status.state === "unconfigured" ? "no OAuth client configured" : status.state === "disconnected" ? "signed out" : "signed in"}`);
    io.out(`last sync: ${status.lastRun ? `${relativeTime(status.lastRun.finishedAt)} by ${status.lastRun.app} on ${status.lastRun.host}` : "never"}`);
    return 0;
  }
  throw new UsageError("Usage: labshelf auth login | logout | status");
}

/**
 * `labshelf doctor`: checks everything the terminal app depends on, without needing a working library.
 * @returns the exit code (1 when something essential is missing)
 */
export async function runDoctor(root: string | undefined, rootSource: string, config: TerminalConfig, io: Output): Promise<number> {
  let essentialMissing = false;
  const line = (ok: boolean | "warn", label: string, detail: string): void => {
    io.out(`${ok === true ? "ok  " : ok === "warn" ? "warn" : "FAIL"}  ${label.padEnd(16)} ${detail}`);
  };
  const major = Number(process.versions.node.split(".")[0]);
  line(major >= 22, "node", process.version);
  if (major < 22) { essentialMissing = true; }
  line(true, "config", `${sharedConfigPath()}${config.libraryRoot ? "" : " (no libraryRoot yet)"}`);
  if (!root) {
    line(false, "library", "not configured — run `labshelf init <path>` (use the folder VS Code uses)");
    essentialMissing = true;
  } else {
    const layout = libraryLayout(root, path.join);
    const exists = await fs.stat(layout.papersRoot()).then((s) => s.isDirectory(), () => false);
    line(exists, "library", `${root} (from ${rootSource})`);
    if (!exists) { essentialMissing = true; }
    const lock = await fs.readFile(layout.lockPath(), "utf8").catch(() => undefined);
    if (lock) { line("warn", "sync lock", `held: ${lock.replace(/\s+/g, " ").slice(0, 120)}`); }
    const last = await fs.readFile(layout.lastRunPath(), "utf8").then((t) => JSON.parse(t) as { finishedAt?: string; app?: string }, () => undefined);
    line(last ? true : "warn", "last sync", last?.finishedAt ? `${relativeTime(last.finishedAt)} by ${last.app}` : "never (by an app that records it)");
  }
  const client = resolveOAuthClient();
  line(client ? true : "warn", "drive client", client ? `configured (${client.clientId.slice(0, 12)}…)` : "missing: rebuild with the VS Code extension's credentials, or set LABSHELF_GOOGLE_CLIENT_ID/SECRET to a client of the same Google Cloud project");
  const store = createTokenStore();
  const tokens = await store.load().catch(() => null);
  line(tokens ? true : "warn", "drive sign-in", tokens ? `signed in (tokens in ${store.kind})` : `signed out — run \`labshelf auth login\` (tokens go to ${store.kind})`);
  const protocol = detectImageProtocol(process.env, process.env["LABSHELF_IMAGES"] ?? config.terminal?.images ?? "auto");
  line(protocol !== "none" ? true : "warn", "thumbnails", protocol !== "none"
    ? `${protocol} protocol (${process.env["TERM_PROGRAM"] ?? process.env["TERM"]})`
    : "this terminal shows no images (kitty, Ghostty, iTerm2, WezTerm do; LABSHELF_IMAGES=iterm forces one)");
  line(hasCommand("pdftoppm") ? true : "warn", "pdftoppm", hasCommand("pdftoppm") ? "found" : "not found — thumbnails use pdfjs (slower); brew install poppler");
  const clipboard = process.platform === "darwin" ? hasCommand("pbcopy") : hasCommand("wl-copy") || hasCommand("xclip") || hasCommand("xsel");
  line(clipboard ? true : "warn", "clipboard", clipboard ? "system clipboard" : "no clipboard tool; using OSC 52 escapes");
  line(true, "config dir", sharedConfigDir());
  return essentialMissing ? 1 : 0;
}
