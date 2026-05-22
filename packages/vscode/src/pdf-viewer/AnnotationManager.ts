/**
 * Manages create, read, update, and delete operations for paper annotations, delegating persistence to PaperDataStore and emitting events on each change.
 *
 * @depends pdf-viewer/config.ts, storage/data/paperDataStore.ts, @labshelf/core
 * @dependents pdf-viewer/PdfViewerPanel.ts, pdf-viewer/index.ts
 */
import type { PaperDataStore } from "../storage/data/paperDataStore.js";
import type { ExtensionEventBus, Annotation, AnnotationType, AnnotationColor, AnnotationPosition } from "@labshelf/core";
import { EVENTS } from "@labshelf/core";
import { PDF_VIEWER_CONFIG } from "./config.js";

const VALID_TYPES: AnnotationType[] = ['highlight', 'note', 'comment', 'tag'];
const VALID_COLORS = PDF_VIEWER_CONFIG.COLORS.highlight as readonly string[];

export class AnnotationManager {
  // Maps an annotation id to its owning paperId. Populated whenever annotations
  // are created or listed, so updateAnnotation(id, content) can locate the
  // sidecar without a SQLite cache.
  private readonly ownerIndex = new Map<string, string>();

  constructor(
    private readonly dataStore: PaperDataStore,
    private readonly eventBus: ExtensionEventBus,
  ) {}

  /**
   * Creates a highlight annotation for the given paper and page, validates inputs, and emits ANNOTATION_CREATED.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns The newly created Annotation record.
   */
  async createHighlight(
    paperId: string,
    pageNumber: number,
    text: string,
    color: AnnotationColor,
    position?: AnnotationPosition,
  ): Promise<Annotation> {
    this.validateColor(color);
    this.validatePageNumber(pageNumber);
    if (!text.trim()) { throw new Error('Highlight content cannot be empty'); }
    if (position) { this.validatePosition(position); }

    const annotation = await this.dataStore.addAnnotation(paperId, {
      paperId,
      type: 'highlight',
      pageNumber,
      content: text,
      color,
      ...(position ? { position } : {}),
    });
    this.ownerIndex.set(annotation.id, paperId);
    this.eventBus.emit(EVENTS.ANNOTATION_CREATED, annotation);
    return annotation;
  }

  /**
   * Creates a note annotation for the given paper and page, validates inputs, and emits ANNOTATION_CREATED.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns The newly created Annotation record.
   */
  async createNote(paperId: string, pageNumber: number, content: string): Promise<Annotation> {
    this.validatePageNumber(pageNumber);
    if (!content.trim()) { throw new Error('Note content cannot be empty'); }

    const annotation = await this.dataStore.addAnnotation(paperId, {
      paperId,
      type: 'note',
      pageNumber,
      content,
    });
    this.ownerIndex.set(annotation.id, paperId);
    this.eventBus.emit(EVENTS.ANNOTATION_CREATED, annotation);
    return annotation;
  }

  /**
   * Returns all annotations for the specified paper and updates the in-memory owner index.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns Array of Annotation records for the paper.
   */
  async getAnnotationsByPaper(paperId: string): Promise<Annotation[]> {
    const annotations = await this.dataStore.getAnnotations(paperId);
    for (const a of annotations) { this.ownerIndex.set(a.id, paperId); }
    return annotations;
  }

  /**
   * Returns all annotations for the specified paper on a given page and updates the in-memory owner index.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns Array of Annotation records for that page.
   */
  async getAnnotationsByPage(paperId: string, pageNumber: number): Promise<Annotation[]> {
    const annotations = await this.dataStore.getAnnotationsByPage(paperId, pageNumber);
    for (const a of annotations) { this.ownerIndex.set(a.id, paperId); }
    return annotations;
  }

  /**
   * Updates the content of an existing annotation by id and emits ANNOTATION_UPDATED.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns The updated Annotation record.
   */
  async updateAnnotation(id: string, content: string): Promise<Annotation> {
    if (!content.trim()) { throw new Error('Annotation content cannot be empty'); }
    const paperId = await this.resolvePaperId(id);
    if (!paperId) { throw new Error(`Annotation not found: ${id}`); }
    const updated = await this.dataStore.updateAnnotation(paperId, id, content);
    if (!updated) { throw new Error(`Annotation not found: ${id}`); }
    this.eventBus.emit(EVENTS.ANNOTATION_UPDATED, updated);
    return updated;
  }

  /**
   * Deletes the annotation with the given id from the sidecar store and emits ANNOTATION_DELETED.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns void
   */
  async deleteAnnotation(id: string, paperId: string): Promise<void> {
    await this.dataStore.deleteAnnotation(paperId, id);
    this.ownerIndex.delete(id);
    this.eventBus.emit(EVENTS.ANNOTATION_DELETED, { annotationId: id, paperId });
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  // Resolves which paper owns an annotation id from the in-memory owner index,
  // populated by createHighlight/createNote and the getAnnotations* methods.
  private async resolvePaperId(id: string): Promise<string | null> {
    return this.ownerIndex.get(id) ?? null;
  }

  // ── Validation helpers ────────────────────────────────────────────────────

  /**
   * Throws if the given color string is not one of the allowed annotation colors.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns void
   */
  validateColor(color: string): void {
    if (!VALID_COLORS.includes(color)) {
      throw new Error(`Invalid annotation color: ${color}. Must be one of: ${VALID_COLORS.join(', ')}`);
    }
  }

  /**
   * Throws if the given type string is not one of the allowed annotation types.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns void
   */
  validateType(type: string): void {
    if (!VALID_TYPES.includes(type as AnnotationType)) {
      throw new Error(`Invalid annotation type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
    }
  }

  /**
   * Throws if the given page number is not a positive integer.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns void
   */
  validatePageNumber(pageNumber: number): void {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new Error(`Invalid page number: ${pageNumber}. Must be a positive integer`);
    }
  }

  /**
   * Validates and returns a normalized AnnotationPosition; throws a descriptive error for any invalid field.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns A validated AnnotationPosition with x, y, width, height in the [0, 1] range.
   */
  validatePosition(pos: unknown): AnnotationPosition {
    if (!pos || typeof pos !== 'object' || Array.isArray(pos)) {
      throw new Error('Position must be an object with x, y, width, height');
    }
    const p = pos as Record<string, unknown>;
    if (typeof p.x !== 'number' || typeof p.y !== 'number' ||
        typeof p.width !== 'number' || typeof p.height !== 'number') {
      throw new Error('Position fields x, y, width, height must be numbers');
    }
    if (p.x < 0 || p.y < 0 || p.width <= 0 || p.height <= 0 ||
        p.x > 1 || p.y > 1 || p.x + (p.width as number) > 1 || p.y + (p.height as number) > 1) {
      throw new Error('Position values must be normalized (0.0-1.0) and width/height must be positive');
    }
    return { x: p.x as number, y: p.y as number, width: p.width as number, height: p.height as number };
  }
}
