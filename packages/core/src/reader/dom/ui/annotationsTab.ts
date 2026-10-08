/**
 * Annotations tab: the paper's highlights and notes grouped by page, with jump, delete and Markdown export.
 */
import type { Annotation } from "../../../types/index.js";
import { h, iconButton } from "./dom.js";
import type { HostBridge } from "./hostBridge.js";
import { icon } from "./icons.js";
import type { SidebarPanel } from "./sidebar.js";

const PREVIEW_CHARS = 140;

export class AnnotationsTab implements SidebarPanel {
  readonly el = h("div", { class: "rd-panel rd-annotations", role: "tabpanel" });
  private readonly list = h("div", { class: "rd-ann-list" });
  private annotations: Annotation[] = [];

  constructor(private readonly host: HostBridge, private readonly goToPage: (page: number) => void) {
    const copyBtn = iconButton(icon("clipboard"), "Copy annotations as Markdown", "rd-btn-sm");
    const fileBtn = iconButton(icon("download"), "Export annotations to a Markdown file", "rd-btn-sm");
    copyBtn.addEventListener("click", () => host.post({ command: "exportAnnotations", target: "clipboard" }));
    fileBtn.addEventListener("click", () => host.post({ command: "exportAnnotations", target: "file" }));
    this.el.append(
      h("div", { class: "rd-panel-header" }, h("span", {}, "Annotations"), h("div", { class: "rd-panel-actions" }, copyBtn, fileBtn)),
      this.list,
    );
    this.render();
  }

  onShow(): void { /* always current */ }
  onHide(): void { /* nothing to release */ }

  /**
   * Replaces the displayed annotations and re-renders the list.
   * @returns void
   */
  setAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations;
    this.render();
  }

  private render(): void {
    if (this.annotations.length === 0) {
      this.list.replaceChildren(h("div", { class: "rd-empty" }, "No annotations yet. Select text to highlight it."));
      return;
    }
    const sorted = [...this.annotations].sort(
      (a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt),
    );
    const frag = document.createDocumentFragment();
    let page = -1;
    for (const ann of sorted) {
      if (ann.pageNumber !== page) {
        page = ann.pageNumber;
        frag.append(h("div", { class: "rd-ann-group" }, `Page ${page}`));
      }
      const content = ann.content ?? "";
      const preview = content.length > PREVIEW_CHARS ? `${content.slice(0, PREVIEW_CHARS)}…` : content;
      const del = iconButton(icon("trash"), "Delete annotation", "rd-btn-sm rd-ann-delete");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.host.post({ command: "deleteAnnotation", id: ann.id });
      });
      const item = h(
        "div",
        { class: "rd-ann-item", role: "button", tabindex: 0, title: `Go to page ${ann.pageNumber}` },
        h("span", { class: `rd-ann-dot rd-color-${ann.color ?? "note"}` }),
        h("span", { class: "rd-ann-text" }, preview),
        del,
      );
      const jump = (): void => this.goToPage(ann.pageNumber);
      item.addEventListener("click", jump);
      item.addEventListener("keydown", (e) => { if (e.key === "Enter") { jump(); } });
      frag.append(item);
    }
    this.list.replaceChildren(frag);
  }
}
