/**
 * Renders a centered placeholder string used by every pane when its data slice
 * is empty. Kept as a separate module so the markup stays one place to tweak.
 *
 * @depends none
 * @dependents collectionsTreeView, paperListView, paperDetailView
 */

/** Returns the HTML for a centered empty-state message. */
export function emptyState(text: string): string {
  return `<p class="empty">${escapeHtml(text)}</p>`;
}

/** Minimal HTML escaper for inline string templates. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
