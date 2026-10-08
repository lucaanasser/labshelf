/**
 * VS Code-style quick input widgets: a filterable QuickPick and a single-line
 * InputBox with live validation. Both resolve to `undefined` when dismissed
 * (Escape, click outside). Used where the VS Code extension calls
 * `window.showQuickPick` / `window.showInputBox`, so folder moves and renames
 * feel the same in the browser.
 *
 * @depends ui/dom, ui/icons
 * @dependents library-page controllers (folder CRUD, move papers, add from tab)
 */
import { el, highlight, tokenize } from "./dom";
import { icon } from "./icons";
import type { IconName } from "./icons";

export interface QuickPickItem<T> {
  label: string;
  description?: string;
  icon?: IconName;
  value: T;
}

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
}

export interface InputBoxOptions {
  title?: string;
  prompt?: string;
  value?: string;
  placeholder?: string;
  /** Returns an error message to block submission, or null/undefined to accept. */
  validate?: (value: string) => string | null | undefined;
}

/** Shows a filterable list; resolves with the chosen item's value. */
export function quickPick<T>(items: QuickPickItem<T>[], opts: QuickPickOptions = {}): Promise<T | undefined> {
  return new Promise((resolve) => {
    const input = el("input", { class: "ls-input", type: "text", placeholder: opts.placeholder ?? "", spellcheck: "false", autocomplete: "off" });
    const list = el("div", { class: "ls-quick-list", role: "listbox" });
    const box = el("div", { class: "ls-quick", role: "dialog" },
      opts.title ? el("div", { class: "ls-quick-title", text: opts.title }) : null, input, list);
    const { close } = mountOverlay(box, () => resolve(undefined));

    let visible: QuickPickItem<T>[] = items;
    let active = 0;

    const render = (): void => {
      const toks = tokenize(input.value);
      visible = toks.length
        ? items.filter((it) => toks.every((t) => `${it.label} ${it.description ?? ""}`.toLowerCase().includes(t)))
        : items;
      active = Math.min(active, Math.max(0, visible.length - 1));
      list.innerHTML = visible.length === 0 ? `<div class="ls-quick-empty">No matching results</div>` : "";
      visible.forEach((it, i) => {
        const row = el("div", {
          class: `ls-quick-item${i === active ? " active" : ""}`,
          role: "option",
          html: `${it.icon ? icon(it.icon) : ""}<span class="label">${highlight(it.label, toks)}</span>${it.description ? `<span class="desc">${highlight(it.description, toks)}</span>` : ""}`,
        });
        row.addEventListener("mousemove", () => { if (active !== i) { active = i; paintActive(); } });
        row.addEventListener("click", () => pick(i));
        list.append(row);
      });
    };
    const paintActive = (): void => {
      list.querySelectorAll(".ls-quick-item").forEach((r, i) => r.classList.toggle("active", i === active));
      list.querySelector(".ls-quick-item.active")?.scrollIntoView({ block: "nearest" });
    };
    const pick = (i: number): void => {
      const it = visible[i];
      if (!it) return;
      close();
      resolve(it.value);
    };

    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(visible.length - 1, active + 1); paintActive(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); paintActive(); }
      else if (e.key === "Enter") { e.preventDefault(); pick(active); }
    });
    render();
    input.focus();
  });
}

/** Shows a single-line input; resolves with the trimmed value or undefined when cancelled. */
export function inputBox(opts: InputBoxOptions = {}): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = el("input", { class: "ls-input", type: "text", value: opts.value ?? "", placeholder: opts.placeholder ?? "", spellcheck: "false", autocomplete: "off" });
    const msg = el("div", { class: "ls-quick-msg", text: opts.prompt ?? "" });
    const box = el("div", { class: "ls-quick", role: "dialog" },
      opts.title ? el("div", { class: "ls-quick-title", text: opts.title }) : null, input, msg);
    const { close } = mountOverlay(box, () => resolve(undefined));

    const validate = (): string | null => {
      const error = opts.validate?.(input.value) ?? null;
      input.setAttribute("aria-invalid", error ? "true" : "false");
      msg.classList.toggle("error", !!error);
      msg.textContent = error ?? opts.prompt ?? "";
      return error;
    };
    input.addEventListener("input", validate);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (validate()) return;
      close();
      resolve(input.value.trim());
    });
    input.focus();
    input.select();
  });
}

/** Options for where an overlay mounts. */
export interface OverlayOptions {
  /** Mount inside this shadow root (a content script's overlay) instead of document.body. */
  root?: ShadowRoot;
}

/**
 * Renders `content` inside a dimmed scrim; Escape or clicking the scrim runs
 * `onDismiss`. With `opts.root` the overlay mounts inside a shadow root (the
 * Scholar content script's overlay), and focus is read and trapped against
 * that root; without it the behaviour is identical to mounting on the body.
 */
export function mountOverlay(content: HTMLElement, onDismiss: () => void, opts: OverlayOptions = {}): { close: () => void } {
  const parent: ShadowRoot | HTMLElement = opts.root ?? document.body;
  const scope: DocumentOrShadowRoot = opts.root ?? document;
  const scrim = el("div", { class: "ls-scrim dim" });
  const previous = scope.activeElement as HTMLElement | null;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); dismiss(); }
    else if (e.key === "Tab") { trapFocus(e, content, scope); }
  };
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    content.remove();
    previous?.focus?.();
  };
  const dismiss = (): void => { close(); onDismiss(); };
  scrim.addEventListener("mousedown", dismiss);
  document.addEventListener("keydown", onKey, true);
  parent.append(scrim, content);
  return { close };
}

function trapFocus(e: KeyboardEvent, root: HTMLElement, scope: DocumentOrShadowRoot): void {
  const focusable = Array.from(root.querySelectorAll<HTMLElement>("input, button:not(:disabled), [tabindex]"));
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (e.shiftKey && scope.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && scope.activeElement === last) { e.preventDefault(); first.focus(); }
}
