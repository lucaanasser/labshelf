/**
 * Tiny DOM helpers for the reader webview; no framework, the UI is a handful of overlays around pdf.js.
 *
 * @depends none
 * @dependents webview/ui/*
 */

/**
 * Looks up a required shell element by id, throwing if the static HTML shell is missing it.
 * @usedBy webview/reader.ts, webview/ui/*
 * @returns the element, typed as `T`.
 */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) { throw new Error(`Reader shell is missing #${id}`); }
  return el as T;
}

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/**
 * Creates an element. `class`, `title`, `data-*`, `aria-*` etc. are set as attributes; `html` sets trusted markup (icons only).
 * @usedBy webview/ui/*
 * @returns the created element.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs & { html?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) { continue; }
    if (k === "html") { el.innerHTML = String(v); continue; }
    el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) { continue; }
    el.append(c);
  }
  return el;
}

/**
 * Icon-only button with an accessible name; the tooltip doubles as shortcut documentation.
 * @usedBy webview/ui/*
 * @returns the button element.
 */
export function iconButton(iconHtml: string, title: string, extraClass = ""): HTMLButtonElement {
  return h("button", {
    class: `rd-btn ${extraClass}`.trim(),
    type: "button",
    title,
    "aria-label": title,
    html: iconHtml,
  });
}

/**
 * @usedBy webview/ui/keyboard.ts
 * @returns true when typing into the target should produce text rather than trigger single-key shortcuts.
 */
export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) { return false; }
  if (target.isContentEditable) { return true; }
  if (target instanceof HTMLTextAreaElement) { return true; }
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "color", "range"].includes(target.type);
  }
  return false;
}

/**
 * @usedBy webview/ui/*
 * @returns `n` limited to [min, max].
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
