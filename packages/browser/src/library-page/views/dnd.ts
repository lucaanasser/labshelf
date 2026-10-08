/**
 * Drag-and-drop plumbing shared by the paper list (drag source) and every
 * folder surface (drop targets: tree rows, subfolder chips, breadcrumb
 * segments). Uses the same private MIME type as the VS Code panel; while a
 * drag is in flight `body.dragging-papers` lights up every valid target.
 *
 * @depends library-page/events
 * @dependents views/paperListView, views/sidebarTreeView, views/filterBarView, views/listHeaderView
 */
import { emit } from "../events";

export const DRAG_MIME = "application/x-labshelf-papers";

/** Marks `el` as a place papers can be dropped to move them into `folder`. */
export function makeDropTarget(el: HTMLElement, folder: string): void {
  const accepts = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes(DRAG_MIME);
  el.addEventListener("dragover", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    el.classList.remove("drop-target");
    if (!accepts(e)) return;
    e.preventDefault();
    let ids: string[] = [];
    try { ids = JSON.parse(e.dataTransfer?.getData(DRAG_MIME) ?? "[]") as string[]; } catch { ids = []; }
    if (ids.length) emit("labshelf:move-papers", { ids, target: folder });
  });
}

/** Starts a paper drag carrying `ids`; `label` is the plain-text fallback. */
export function startPaperDrag(e: DragEvent, ids: string[], label: string): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "move";
  document.body.classList.add("dragging-papers");
}

/** Clears the global drag affordance. */
export function endPaperDrag(): void {
  document.body.classList.remove("dragging-papers");
}
