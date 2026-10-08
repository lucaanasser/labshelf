/** PathOps for "/"-separated paths, for runtimes without node:path (the browser's relative store keys). */
import type { PathOps } from "./context.js";

function join(...parts: string[]): string {
  const joined = parts.filter((part) => part !== "").join("/").replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

function dirname(target: string): string {
  const trimmed = target.length > 1 ? target.replace(/\/$/, "") : target;
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) { return "."; }
  return slash === 0 ? "/" : trimmed.slice(0, slash);
}

function basename(target: string, ext?: string): string {
  const name = target.replace(/\/$/, "").slice(target.replace(/\/$/, "").lastIndexOf("/") + 1);
  return ext && name !== ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

export const posixPathOps: PathOps = { sep: "/", join, dirname, basename };
