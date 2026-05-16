/**
 * Module: Core Types
 * Responsibility: Shared domain types for papers and logs
 * Dependencies: none
 */
export type PaperStatus = "unread" | "reading" | "done";

export interface PaperRecord {
  id: string;
  title: string;
  authors?: string[];
  year?: number;
  path: string;
  citeKey: string;
  status: PaperStatus;
  summary?: string;
  // Bibliographic metadata (populated via CrossRef / arXiv when a DOI/ID is found)
  journal?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  issn?: string;
  language?: string;
}

export interface AnnotationPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnnotationType = 'highlight' | 'note' | 'comment' | 'tag';
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'red' | 'pink';
export type PdfTheme = 'auto' | 'light' | 'dark' | 'sepia' | 'high-contrast';

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

export interface BatchImportResult {
  success: PaperRecord[];
  failed: Array<{ path: string; error: string }>;
  skipped: string[];
}

export interface LogEntry {
  timestamp: string;
  level: "ERROR" | "WARN" | "INFO";
  module: string;
  message: string;
  stack?: string;
  context: Record<string, unknown>;
}
