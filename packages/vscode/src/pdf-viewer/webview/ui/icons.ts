/**
 * Inline SVG icons for the reader (Feather geometry, stroke=currentColor), mirroring ui/list/template.icons.ts. The repo forbids emoji and decorative Unicode glyphs in UI.
 *
 * @depends none
 * @dependents pdf-viewer/webview/ui/*
 */

export type IconName =
  | "sidebar" | "search" | "chevron-up" | "chevron-down" | "chevron-left" | "chevron-right"
  | "arrow-left" | "arrow-right" | "plus" | "minus" | "grid" | "list" | "edit" | "copy"
  | "x" | "droplet" | "download" | "help" | "quote" | "external" | "trash" | "clipboard";

const c = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

/**
 * @usedBy pdf-viewer/webview/ui/*
 * @returns trusted SVG markup for the named icon.
 */
export function icon(name: IconName): string {
  switch (name) {
    case "sidebar": return `<svg ${c}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`;
    case "search": return `<svg ${c}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    case "chevron-up": return `<svg ${c}><polyline points="18 15 12 9 6 15"/></svg>`;
    case "chevron-down": return `<svg ${c}><polyline points="6 9 12 15 18 9"/></svg>`;
    case "chevron-left": return `<svg ${c}><polyline points="15 18 9 12 15 6"/></svg>`;
    case "chevron-right": return `<svg ${c}><polyline points="9 18 15 12 9 6"/></svg>`;
    case "arrow-left": return `<svg ${c}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
    case "arrow-right": return `<svg ${c}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
    case "plus": return `<svg ${c}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    case "minus": return `<svg ${c}><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    case "grid": return `<svg ${c}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
    case "list": return `<svg ${c}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
    case "edit": return `<svg ${c}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    case "copy": return `<svg ${c}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    case "x": return `<svg ${c}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    case "droplet": return `<svg ${c}><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
    case "download": return `<svg ${c}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    case "help": return `<svg ${c}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    case "quote": return `<svg ${c}><path d="M10 12H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5a3 3 0 0 1-3 3"/><path d="M19 12h-4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5a3 3 0 0 1-3 3"/></svg>`;
    case "external": return `<svg ${c}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    case "trash": return `<svg ${c}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
    case "clipboard": return `<svg ${c}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`;
  }
}
