/**
 * Flattens a pdf.js outline tree into rows the Outline tab can render, collapse and track against the current page.
 *
 * @depends none
 * @dependents webview/ui/outlineTab.ts
 */

/** Structural subset of pdf.js' `getOutline()` node. */
export interface RawOutlineNode {
  title: string;
  dest?: string | unknown[] | null;
  url?: string | null;
  bold?: boolean;
  italic?: boolean;
  items?: RawOutlineNode[];
}

export interface OutlineRow {
  id: number;
  parentId: number | null;
  depth: number;
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  hasChildren: boolean;
  bold: boolean;
}

// Some generators emit cyclic or absurdly deep outlines; stop before the tab becomes unusable.
const MAX_DEPTH = 12;
const MAX_ROWS = 5000;

/**
 * @usedBy webview/ui/outlineTab.ts
 * @returns rows in document order with stable numeric ids.
 */
export function flattenOutline(nodes: readonly RawOutlineNode[] | null | undefined): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (list: readonly RawOutlineNode[], depth: number, parentId: number | null): void => {
    for (const node of list) {
      if (rows.length >= MAX_ROWS) { return; }
      const children = depth + 1 < MAX_DEPTH ? (node.items ?? []) : [];
      const id = rows.length;
      rows.push({
        id,
        parentId,
        depth,
        title: (node.title ?? "").replace(/\s+/g, " ").trim() || "Untitled",
        dest: node.dest ?? null,
        url: node.url ?? null,
        hasChildren: children.length > 0,
        bold: node.bold === true,
      });
      if (children.length > 0) { walk(children, depth + 1, id); }
    }
  };
  walk(nodes ?? [], 0, null);
  return rows;
}

/**
 * @usedBy webview/ui/outlineTab.ts
 * @returns the rows not hidden beneath a collapsed ancestor.
 */
export function visibleRows(rows: readonly OutlineRow[], collapsed: ReadonlySet<number>): OutlineRow[] {
  const hidden = new Set<number>();
  const out: OutlineRow[] = [];
  for (const row of rows) {
    const parentHidden = row.parentId !== null && (hidden.has(row.parentId) || collapsed.has(row.parentId));
    if (parentHidden) { hidden.add(row.id); continue; }
    out.push(row);
  }
  return out;
}

/**
 * The active outline entry is the last one starting at or before the current page.
 * @usedBy webview/ui/outlineTab.ts
 * @returns an index into `rowPages`, or -1 when no entry qualifies (pages not yet resolved are null).
 */
export function activeOutlineIndex(rowPages: readonly (number | null)[], currentPage: number): number {
  let best = -1;
  let bestPage = -1;
  rowPages.forEach((page, i) => {
    if (page !== null && page <= currentPage && page >= bestPage) {
      best = i;
      bestPage = page;
    }
  });
  return best;
}
