/**
 * Bottom-right notifications styled after VS Code toasts. Errors stay until
 * dismissed; info/ok messages fade after a few seconds. Replaces the footer
 * error pill so failures never hide the sync status.
 *
 * @depends ui/dom, ui/icons
 * @dependents library-page controllers and views, popup
 */
import { el } from "./dom";
import { icon } from "./icons";

export type ToastKind = "info" | "ok" | "error";

const AUTO_DISMISS_MS = 4500;
let host: HTMLElement | null = null;

/** Shows a toast; returns a function that dismisses it early. */
export function toast(message: string, kind: ToastKind = "info"): () => void {
  if (!host) {
    host = el("div", { class: "ls-toasts", role: "status", "aria-live": "polite" });
    document.body.append(host);
  }
  const glyph = kind === "error" ? "warning" : kind === "ok" ? "check" : "info";
  const closeBtn = el("button", { class: "ls-icon-btn", type: "button", title: "Dismiss", html: icon("x") });
  const node = el("div", { class: `ls-toast ${kind}` },
    el("span", { html: icon(glyph) }),
    el("div", { class: "msg", text: message }),
    closeBtn,
  );
  const dismiss = (): void => { node.remove(); };
  closeBtn.addEventListener("click", dismiss);
  host.append(node);
  if (kind !== "error") setTimeout(dismiss, AUTO_DISMISS_MS);
  return dismiss;
}
