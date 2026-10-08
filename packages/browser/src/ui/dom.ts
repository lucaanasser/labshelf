/**
 * Small DOM helpers shared by every browser surface: element lookup that fails
 * loudly, HTML escaping for string templates, search-token highlighting, and a
 * terse element factory. Kept framework-free on purpose — the UI is vanilla TS.
 *
 * @depends none
 * @dependents ui/*, popup, options, library-page views
 */

/** Returns the element with the given id or throws — missing mount points are programmer errors. */
export function $<T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Escapes a value for safe interpolation into an HTML string. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes `text` and wraps every occurrence of each search token in <mark>.
 * Mirrors the VS Code list webview so search feedback looks the same.
 */
export function highlight(text: unknown, tokens: string[]): string {
  const str = String(text ?? "");
  if (tokens.length === 0) return esc(str);
  const lower = str.toLowerCase();
  const marks: Array<[number, number]> = [];
  for (const t of tokens) {
    let i = 0;
    while ((i = lower.indexOf(t, i)) !== -1) { marks.push([i, i + t.length]); i += t.length; }
  }
  if (marks.length === 0) return esc(str);
  marks.sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [from, to] of marks) {
    if (to <= pos) continue;
    const start = Math.max(from, pos);
    out += esc(str.slice(pos, start)) + "<mark>" + esc(str.slice(start, to)) + "</mark>";
    pos = to;
  }
  return out + esc(str.slice(pos));
}

type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Creates an element with attributes and children; `html` sets innerHTML, `text` sets textContent. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs & { html?: string; text?: string } = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "html") node.innerHTML = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "class") node.className = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Splits a search query into lowercase tokens. */
export function tokenize(query: string): string[] {
  return query.toLowerCase().split(" ").filter(Boolean);
}

/** Formats an ISO timestamp as a short local time ("14:05") or date when not today. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
