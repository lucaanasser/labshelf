/**
 * Modal confirmation dialog styled after VS Code's custom dialogs. Replaces
 * `window.confirm`, which the browser renders in its own chrome and which the
 * VS Code extension answers with `showWarningMessage({ modal: true })`.
 * Resolves with the chosen button's id, or undefined when dismissed.
 *
 * @depends ui/dom, ui/icons, ui/quickInput (overlay)
 * @dependents library-page controllers (delete paper / folder), popup, content/scholar
 */
import { el } from "./dom";
import { icon } from "./icons";
import { mountOverlay } from "./quickInput";

export interface DialogButton<T extends string> {
  id: T;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogOptions<T extends string> {
  title: string;
  message?: string;
  severity?: "warning" | "danger" | "info";
  buttons: Array<DialogButton<T>>;
  /** Mount inside this shadow root (a content script's overlay) instead of document.body. */
  root?: ShadowRoot;
}

/** Shows a modal dialog and resolves with the id of the pressed button. */
export function showDialog<T extends string>(opts: DialogOptions<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const actions = el("div", { class: "ls-dialog-actions" });
    const glyph = opts.severity === "info" ? "info" : "warning";
    const box = el("div", { class: "ls-dialog", role: "alertdialog", "aria-modal": "true" },
      el("div", { class: "ls-dialog-head" },
        el("span", { html: icon(glyph) }),
        el("div", {},
          el("div", { class: "ls-dialog-title", text: opts.title }),
          opts.message ? el("div", { class: "ls-dialog-msg", text: opts.message }) : null,
        ),
      ),
      actions,
    );
    if (opts.severity === "danger") box.querySelector("svg")?.classList.add("danger");
    const { close } = mountOverlay(box, () => resolve(undefined), opts.root ? { root: opts.root } : {});

    // Cancel sits first, primary last — VS Code's button order.
    const cancel = el("button", { class: "ls-btn", type: "button", text: "Cancel" });
    cancel.addEventListener("click", () => { close(); resolve(undefined); });
    actions.append(cancel);
    let primary: HTMLButtonElement | null = null;
    for (const b of opts.buttons) {
      const btn = el("button", { class: `ls-btn${b.primary ? " ls-btn-primary" : ""}${b.danger ? " ls-btn-danger" : ""}`, type: "button", text: b.label });
      btn.addEventListener("click", () => { close(); resolve(b.id); });
      actions.append(btn);
      if (b.primary) primary = btn;
    }
    (primary ?? cancel).focus();
  });
}

/** Two-button confirmation; resolves true when the user accepts. */
export async function confirmDialog(title: string, message: string, acceptLabel = "OK", danger = false): Promise<boolean> {
  const result = await showDialog({
    title,
    message,
    severity: danger ? "danger" : "warning",
    buttons: [{ id: "ok", label: acceptLabel, primary: true, danger }],
  });
  return result === "ok";
}
