/**
 * Theme picker: the five persisted presets plus session-only custom page colours.
 *
 * @depends webview/ui/{dom,popover,theme,hostBridge}.ts, @labshelf/core (types only)
 * @dependents webview/reader.ts
 */
import type { PdfTheme } from "@labshelf/core";
import { h } from "./dom.js";
import type { HostBridge } from "./hostBridge.js";
import { togglePopover } from "./popover.js";
import type { ThemeController } from "./theme.js";

const THEMES: ReadonlyArray<{ value: PdfTheme; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "sepia", label: "Sepia" },
  { value: "high-contrast", label: "High contrast" },
];

/**
 * A preset is persisted per paper by the host; custom colours apply to this session only.
 * @usedBy webview/reader.ts
 * @returns void
 */
export function openThemePopover(anchor: HTMLElement, theme: ThemeController, host: HostBridge): void {
  const list = h("div", { class: "rd-theme-list", role: "radiogroup", "aria-label": "Page theme" });
  for (const t of THEMES) {
    const btn = h(
      "button",
      { class: "rd-theme-item", type: "button", role: "radio", "aria-checked": theme.preference === t.value ? "true" : "false" },
      h("span", { class: `rd-theme-swatch rd-theme-swatch-${t.value}` }),
      t.label,
    );
    btn.addEventListener("click", () => {
      // The host persists the choice and echoes `applyTheme` with the resolved effective theme.
      host.post({ command: "selectTheme", theme: t.value });
      for (const b of list.querySelectorAll("button")) { b.setAttribute("aria-checked", b === btn ? "true" : "false"); }
    });
    list.append(btn);
  }

  const { bg, text } = theme.colors;
  const bgInput = h("input", { type: "color", value: bg, "aria-label": "Page background colour" });
  const textInput = h("input", { type: "color", value: text, "aria-label": "Text colour" });
  const applyCustom = (): void => theme.applyPageColors(bgInput.value, textInput.value);
  bgInput.addEventListener("change", applyCustom);
  textInput.addEventListener("change", applyCustom);

  const content = h(
    "div",
    { class: "rd-theme-popover" },
    list,
    h("div", { class: "rd-menu-sep" }),
    h("div", { class: "rd-theme-custom" },
      h("span", { class: "rd-theme-custom-title" }, "Custom"),
      h("label", {}, "Page", bgInput),
      h("label", {}, "Text", textInput),
    ),
  );
  togglePopover(anchor, content, "below");
}
