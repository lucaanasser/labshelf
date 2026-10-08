/**
 * Context / dropdown menu styled after VS Code's custom menus. Positions itself
 * at a point or under an anchor element, clamps to the viewport, closes on
 * outside click or Escape, and supports arrow-key navigation. One menu is open
 * at a time; opening another closes the previous one. Mounts on document.body,
 * or inside a shadow root when the host page's CSS must not reach it (the
 * Google Scholar buttons).
 *
 * @depends ui/dom, ui/icons
 * @dependents library-page views (sidebar context menu, "+ Add" dropdown), popup, content/scholar
 */
import { el } from "./dom";
import { icon } from "./icons";
import type { IconName } from "./icons";

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}
export type MenuEntry = MenuItem | "separator";

export interface MenuAnchor { x: number; y: number }

export interface MenuOptions {
  /** Where to mount the menu; it must already carry the kit's styles. Defaults to document.body. */
  root?: ShadowRoot;
}

let closeCurrent: (() => void) | null = null;

/** Closes whichever menu is open, if any. */
export function closeMenu(): void {
  closeCurrent?.();
}

/** Opens a menu at a point (right-click) or below an anchor element (dropdown). */
export function showMenu(anchor: MenuAnchor | HTMLElement, entries: MenuEntry[], opts: MenuOptions = {}): void {
  closeMenu();

  const menu = el("div", { class: "ls-menu", role: "menu" });
  for (const entry of entries) {
    if (entry === "separator") { menu.append(el("div", { class: "ls-menu-sep", role: "separator" })); continue; }
    const item = el("button", {
      class: `ls-menu-item${entry.danger ? " danger" : ""}`,
      role: "menuitem",
      type: "button",
      disabled: entry.disabled ? true : undefined,
      html: `${entry.icon ? icon(entry.icon) : '<span style="width:14px"></span>'}<span>${escapeText(entry.label)}</span>${entry.hint ? `<span class="hint">${escapeText(entry.hint)}</span>` : ""}`,
    });
    item.addEventListener("click", () => { close(); entry.onSelect(); });
    menu.append(item);
  }

  const scrim = el("div", { class: "ls-scrim" });
  scrim.addEventListener("mousedown", close);
  scrim.addEventListener("contextmenu", (e) => { e.preventDefault(); close(); });
  (opts.root ?? document.body).append(scrim, menu);
  const focusScope: DocumentOrShadowRoot = opts.root ?? document;

  const point = anchor instanceof HTMLElement ? anchorPoint(anchor) : anchor;
  place(menu, point, anchor instanceof HTMLElement ? anchor.getBoundingClientRect().height : 0);

  const onKey = (e: KeyboardEvent): void => {
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(".ls-menu-item:not(:disabled)"));
    const idx = items.indexOf(focusScope.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); }
  };
  document.addEventListener("keydown", onKey, true);
  menu.querySelector<HTMLButtonElement>(".ls-menu-item:not(:disabled)")?.focus();

  function close(): void {
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    menu.remove();
    if (closeCurrent === close) closeCurrent = null;
  }
  closeCurrent = close;
}

function anchorPoint(anchor: HTMLElement): MenuAnchor {
  const r = anchor.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 2 };
}

// Flips above / left of the anchor when the default placement would overflow the viewport.
function place(menu: HTMLElement, point: MenuAnchor, anchorHeight: number): void {
  const pad = 6;
  const { width, height } = menu.getBoundingClientRect();
  let x = point.x;
  let y = point.y;
  if (x + width + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - width - pad);
  if (y + height + pad > window.innerHeight) y = Math.max(pad, point.y - height - anchorHeight - 4);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
