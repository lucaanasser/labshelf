/**
 * The few places the terminal app touches the desktop: copying to the clipboard, opening a PDF or folder with the
 * user's apps, moving folders to the trash, and running $EDITOR. Each one degrades instead of failing: no clipboard
 * tool falls back to OSC 52 (works over SSH), no trash support is reported so the caller can ask before deleting.
 *
 * @depends none
 * @dependents ui/app, cli/commands, library/paperService
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Runs a command, feeding stdin; resolves false when it is missing or fails. */
function pipeTo(command: string, args: string[], input: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.end(input);
  });
}

/**
 * Whether an executable is on PATH.
 * @usedBy copyToClipboard, preview/thumbnails, cli doctor
 * @returns true when found
 */
export function hasCommand(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dirs = (env["PATH"] ?? "").split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => existsSync(path.join(dir, command)));
}

/**
 * Copies text to the system clipboard; `osc52` receives the escape fallback when no clipboard tool exists.
 * @usedBy ui/app, cli/commands
 * @returns how it was copied
 */
export async function copyToClipboard(text: string, osc52?: (sequence: string) => void): Promise<"system" | "osc52" | "failed"> {
  const candidates: Array<[string, string[]]> = process.platform === "darwin"
    ? [["pbcopy", []]]
    : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  for (const [command, args] of candidates) {
    if (hasCommand(command) && (await pipeTo(command, args, text))) { return "system"; }
  }
  if (osc52) {
    osc52(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
    return "osc52";
  }
  return "failed";
}

/**
 * Opens a file or folder with the system's default app (or `viewer` when configured), without waiting for it.
 * @usedBy ui/app, cli open
 * @returns void; throws when the opener cannot start
 */
export function openExternal(target: string, viewer?: string): void {
  let command: string;
  let args: string[];
  if (viewer && viewer.trim()) {
    const parts = viewer.trim().split(/\s+/);
    command = parts[0]!;
    args = [...parts.slice(1), target];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [target];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", target];
  } else {
    command = "xdg-open";
    args = [target];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

/**
 * Reveals a folder in Finder / the file manager.
 * @usedBy ui/app
 * @returns void
 */
export function revealInFileManager(target: string): void {
  if (process.platform === "darwin") {
    const child = spawn("open", ["-R", target], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
    return;
  }
  openExternal(path.dirname(target));
}

/**
 * Whether moveToTrash works on this platform.
 * @usedBy ui/app, cli rm
 * @returns true on macOS and freedesktop systems
 */
export function trashSupported(): boolean {
  return process.platform === "darwin" || process.platform === "linux";
}

async function uniqueName(dir: string, name: string): Promise<string> {
  let candidate = name;
  for (let n = 2; existsSync(path.join(dir, candidate)); n++) {
    candidate = `${name} ${n}`;
  }
  return candidate;
}

async function moveAcrossVolumes(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") { throw error; }
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

/**
 * Moves a file or folder to the user's trash (macOS ~/.Trash, freedesktop ~/.local/share/Trash), the same thing the
 * VS Code extension does with useTrash.
 * @usedBy library/paperService
 * @returns the path it now has in the trash
 */
export async function moveToTrash(target: string): Promise<string> {
  const name = path.basename(target);
  if (process.platform === "darwin") {
    const trash = path.join(os.homedir(), ".Trash");
    await fs.mkdir(trash, { recursive: true });
    const destination = path.join(trash, await uniqueName(trash, name));
    await moveAcrossVolumes(target, destination);
    return destination;
  }
  if (process.platform === "linux") {
    const base = process.env["XDG_DATA_HOME"] || path.join(os.homedir(), ".local", "share");
    const files = path.join(base, "Trash", "files");
    const info = path.join(base, "Trash", "info");
    await fs.mkdir(files, { recursive: true });
    await fs.mkdir(info, { recursive: true });
    const trashedName = await uniqueName(files, name);
    await fs.writeFile(
      path.join(info, `${trashedName}.trashinfo`),
      `[Trash Info]\nPath=${encodeURI(path.resolve(target))}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`,
    );
    const destination = path.join(files, trashedName);
    await moveAcrossVolumes(target, destination);
    return destination;
  }
  throw new Error("Moving to the trash is not supported on this platform");
}

/**
 * Runs the user's editor on a file in the foreground; the caller must have released the terminal.
 * @usedBy ui/app (via Terminal.suspend), cli note
 * @returns true when the editor exited cleanly
 */
export function runEditor(file: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const editor = env["VISUAL"] || env["EDITOR"] || (hasCommand("nvim") ? "nvim" : hasCommand("vim") ? "vim" : "vi");
  // $EDITOR may carry arguments ("code --wait"), so it goes through the shell; the file is single-quoted.
  const quoted = `'${file.replace(/'/g, "'\\''")}'`;
  const result = spawnSync(`${editor} ${quoted}`, { stdio: "inherit", shell: true });
  return result.status === 0;
}
