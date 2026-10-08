/**
 * Annotations on a paper's PDF with their types and colours.
 */
export interface AnnotationPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ANNOTATION_TYPES = ["highlight", "note", "comment", "tag"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export const ANNOTATION_COLORS = ["yellow", "green", "blue", "red", "pink"] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

export function isAnnotationColor(value: unknown): value is AnnotationColor {
  return (ANNOTATION_COLORS as readonly unknown[]).includes(value);
}

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
