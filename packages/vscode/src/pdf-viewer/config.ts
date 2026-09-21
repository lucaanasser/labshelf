/**
 * Centralizes the PDF viewer's host-side constants: annotation colors and theme names.
 * Zoom steps live in pdf-viewer/webview/logic/zoomMath.ts and the default zoom is the `labshelf.reader.defaultZoom` setting.
 *
 * @depends none
 * @dependents pdf-viewer/AnnotationManager.ts, pdf-viewer/ThemeManager.ts, pdf-viewer/index.ts
 */
export const PDF_VIEWER_CONFIG = {
  COLORS: {
    highlight: ['yellow', 'green', 'blue', 'red', 'pink'] as const,
    default: 'yellow' as const,
  },
  THEMES: {
    available: ['auto', 'light', 'dark', 'sepia', 'high-contrast'] as const,
    default: 'auto' as const,
  },
} as const;
