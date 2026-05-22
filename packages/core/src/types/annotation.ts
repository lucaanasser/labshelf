/**
 * Annotation, color, and theme types used by the PDF viewer and annotation services.
 *
 * @depends none
 * @dependents interfaces/database.ts, @labshelf/vscode (pdf-viewer), @labshelf/browser (planned viewer)
 */
export interface AnnotationPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnnotationType = "highlight" | "note" | "comment" | "tag";
export type AnnotationColor = "yellow" | "green" | "blue" | "red" | "pink";
export type PdfTheme = "auto" | "light" | "dark" | "sepia" | "high-contrast";

export interface Annotation {
  id: string;
  paperId: string;
  type: AnnotationType;
  pageNumber: number;
  content: string;
  color?: AnnotationColor;
  position?: AnnotationPosition;
  createdAt: string;
  updatedAt: string;
}
