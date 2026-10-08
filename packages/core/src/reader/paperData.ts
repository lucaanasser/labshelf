/**
 * The per-paper sidecar (data.json: annotations, reader theme, reading position) as both extensions read and write it,
 * plus a platform-free store over it. VS Code keeps it at <library>/.research/papers/<id>/data.json and the browser at
 * IndexedDB path appdata/<id>/data.json; the sync "appdata" namespace maps one onto the other, so the format must not drift.
 */
import type { Annotation, AnnotationColor, AnnotationPosition, PdfTheme } from "../types/index.js";
import { normalizeReadingState, type ReadingState } from "./readingState.js";

export interface PaperData {
  annotations: Annotation[];
  theme: PdfTheme;
  /** Last reading position; absent until the paper has been opened in the reader. */
  reading?: ReadingState;
}

const PDF_THEMES: readonly PdfTheme[] = ["auto", "light", "dark", "sepia", "high-contrast"];
const ANNOTATION_COLORS: readonly AnnotationColor[] = ["yellow", "green", "blue", "red", "pink"];

/**
 * @returns the sidecar of a paper that has never been opened.
 */
export function emptyPaperData(): PaperData {
  return { annotations: [], theme: "auto" };
}

/**
 * @returns true when `value` is one of the reader themes.
 */
export function isPdfTheme(value: unknown): value is PdfTheme {
  return PDF_THEMES.includes(value as PdfTheme);
}

/**
 * Defensive normalization so a corrupt or hand-edited sidecar never throws and never half-applies.
 * @returns clean PaperData; unknown or malformed fields fall back to their defaults.
 */
export function normalizePaperData(parsed: unknown): PaperData {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { return emptyPaperData(); }
  const obj = parsed as Record<string, unknown>;
  const annotations = Array.isArray(obj["annotations"])
    ? (obj["annotations"].filter(
        (a) => a && typeof a === "object" && typeof (a as Annotation).id === "string",
      ) as Annotation[])
    : [];
  const theme = isPdfTheme(obj["theme"]) ? obj["theme"] : "auto";
  const data: PaperData = { annotations, theme };
  const reading = normalizeReadingState(obj["reading"]);
  if (reading) { data.reading = reading; }
  return data;
}

/**
 * The exact bytes both extensions write: fixed key order, two-space indent, `reading` omitted until set.
 * @returns the JSON text of the sidecar.
 */
export function serializePaperData(data: PaperData): string {
  const payload: PaperData = { annotations: data.annotations, theme: data.theme };
  if (data.reading) { payload.reading = data.reading; }
  return JSON.stringify(payload, null, 2);
}

/** Sorted the way the reader lists them: by page, then by creation time. */
function byPageThenCreated(a: Annotation, b: Annotation): number {
  return a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt);
}

/**
 * @returns void; throws when the page number is not a positive integer.
 */
export function validatePageNumber(pageNumber: number): void {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`Invalid page number: ${pageNumber}. Must be a positive integer`);
  }
}

/**
 * @returns the color, typed; throws for anything outside ANNOTATION_COLORS.
 */
export function validateAnnotationColor(color: string): AnnotationColor {
  if (!ANNOTATION_COLORS.includes(color as AnnotationColor)) {
    throw new Error(`Invalid annotation color: ${color}. Must be one of: ${ANNOTATION_COLORS.join(", ")}`);
  }
  return color as AnnotationColor;
}

/**
 * @returns a position whose x, y, width and height are normalized to the page (0..1); throws otherwise.
 */
export function validateAnnotationPosition(pos: unknown): AnnotationPosition {
  if (!pos || typeof pos !== "object" || Array.isArray(pos)) {
    throw new Error("Position must be an object with x, y, width, height");
  }
  const p = pos as Record<string, unknown>;
  const { x, y, width, height } = p;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
    throw new Error("Position fields x, y, width, height must be numbers");
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x > 1 || y > 1 || x + width > 1 || y + height > 1) {
    throw new Error("Position values must be normalized (0.0-1.0) and width/height must be positive");
  }
  return { x, y, width, height };
}

/** Where a platform keeps one sidecar per paper. */
export interface SidecarPort {
  /** The sidecar text, or null when the paper has none yet. */
  read(paperId: string): Promise<string | null>;
  write(paperId: string, text: string): Promise<void>;
}

export interface PaperDataStoreOptions {
  now?: () => string;
  newId?: () => string;
}

/**
 * Load-modify-save over one sidecar per paper. Every mutator of a paper runs in a per-paper queue: the reader saves the
 * reading position while scrolling, and without serialization a position write racing an annotation write drops one.
 */
export class PaperDataStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(private readonly port: SidecarPort, options: PaperDataStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  }

  private enqueue<T>(paperId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(paperId) ?? Promise.resolve();
    // A failed write must not poison the writes queued behind it.
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.queues.set(paperId, settled);
    void settled.then(() => {
      if (this.queues.get(paperId) === settled) { this.queues.delete(paperId); }
    });
    return next;
  }

  /**
   * @returns the paper's sidecar, or empty data when it is absent or unreadable.
   */
  async load(paperId: string): Promise<PaperData> {
    const text = await this.port.read(paperId);
    if (text === null) { return emptyPaperData(); }
    try {
      return normalizePaperData(JSON.parse(text) as unknown);
    } catch {
      return emptyPaperData();
    }
  }

  private async mutate<T>(paperId: string, change: (data: PaperData) => T | null): Promise<T | null> {
    return this.enqueue(paperId, async () => {
      const data = await this.load(paperId);
      const result = change(data);
      if (result !== null) { await this.port.write(paperId, serializePaperData(data)); }
      return result;
    });
  }

  /**
   * @returns the paper's annotations, by page then creation time.
   */
  async getAnnotations(paperId: string): Promise<Annotation[]> {
    return [...(await this.load(paperId)).annotations].sort(byPageThenCreated);
  }

  /**
   * Validates like the VS Code AnnotationManager: known color, positive integer page, non-empty text, normalized position.
   * @returns the stored highlight.
   */
  async addHighlight(
    paperId: string,
    pageNumber: number,
    content: string,
    color: string,
    position?: unknown,
  ): Promise<Annotation> {
    const validColor = validateAnnotationColor(color);
    validatePageNumber(pageNumber);
    if (!content.trim()) { throw new Error("Highlight content cannot be empty"); }
    const validPosition = position === undefined ? undefined : validateAnnotationPosition(position);
    return this.add(paperId, {
      type: "highlight", pageNumber, content, color: validColor, ...(validPosition ? { position: validPosition } : {}),
    });
  }

  /**
   * @returns the stored note.
   */
  async addNote(paperId: string, pageNumber: number, content: string): Promise<Annotation> {
    validatePageNumber(pageNumber);
    if (!content.trim()) { throw new Error("Note content cannot be empty"); }
    return this.add(paperId, { type: "note", pageNumber, content });
  }

  private async add(paperId: string, fields: Pick<Annotation, "type" | "pageNumber" | "content" | "color" | "position">): Promise<Annotation> {
    const at = this.now();
    const annotation: Annotation = { ...fields, paperId, id: this.newId(), createdAt: at, updatedAt: at };
    if (annotation.color === undefined) { delete annotation.color; }
    if (annotation.position === undefined) { delete annotation.position; }
    await this.mutate(paperId, (data) => { data.annotations.push(annotation); return annotation; });
    return annotation;
  }

  /**
   * @returns the updated annotation; throws when the content is empty or the id is unknown.
   */
  async updateAnnotation(paperId: string, id: string, content: string): Promise<Annotation> {
    if (!content.trim()) { throw new Error("Annotation content cannot be empty"); }
    const updated = await this.mutate(paperId, (data) => {
      const index = data.annotations.findIndex((a) => a.id === id);
      if (index === -1) { return null; }
      const next: Annotation = { ...data.annotations[index]!, content, updatedAt: this.now() };
      data.annotations[index] = next;
      return next;
    });
    if (!updated) { throw new Error(`Annotation not found: ${id}`); }
    return updated;
  }

  /**
   * Removing an id that does not exist is a no-op and does not rewrite the file.
   * @returns true when an annotation was removed.
   */
  async deleteAnnotation(paperId: string, id: string): Promise<boolean> {
    const removed = await this.mutate(paperId, (data) => {
      const kept = data.annotations.filter((a) => a.id !== id);
      if (kept.length === data.annotations.length) { return null; }
      data.annotations = kept;
      return true;
    });
    return removed === true;
  }

  /**
   * @returns the paper's stored reader theme ("auto" when never chosen).
   */
  async getTheme(paperId: string): Promise<PdfTheme> {
    return (await this.load(paperId)).theme;
  }

  /**
   * @returns void
   */
  async setTheme(paperId: string, theme: PdfTheme): Promise<void> {
    await this.mutate(paperId, (data) => { data.theme = theme; return true; });
  }

  /**
   * @returns the last reading position, or null when the paper was never opened.
   */
  async getReadingState(paperId: string): Promise<ReadingState | null> {
    return (await this.load(paperId)).reading ?? null;
  }

  /**
   * @returns void
   */
  async setReadingState(paperId: string, reading: ReadingState): Promise<void> {
    await this.mutate(paperId, (data) => { data.reading = reading; return true; });
  }
}
