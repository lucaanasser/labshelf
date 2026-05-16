/**
 * Module: PDF Viewer Configuration
 * Responsibility: Centralize PDF viewer constants (zoom levels, colors, themes, debounce)
 * Dependencies: none
 */
export const PDF_VIEWER_CONFIG = {
  ZOOM_LEVELS: [50, 75, 100, 125, 150, 200] as const,
  DEFAULT_ZOOM: 100,
  COLORS: {
    highlight: ['yellow', 'green', 'blue', 'red', 'pink'] as const,
    default: 'yellow' as const,
  },
  THEMES: {
    available: ['auto', 'light', 'dark', 'sepia', 'high-contrast'] as const,
    default: 'auto' as const,
  },
  DEBOUNCE_MS: 300,
} as const;

export type ZoomLevel = typeof PDF_VIEWER_CONFIG.ZOOM_LEVELS[number];
