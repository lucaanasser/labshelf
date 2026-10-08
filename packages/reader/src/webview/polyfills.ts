/**
 * Runtime polyfills for the reader: what pdf.js 6 needs inside the VS Code webview's Chromium, and the caret API the
 * hover previews use, which Firefox (before 150) only offers in its standard form.
 *
 * @depends none
 * @dependents webview/reader.ts
 */

// Map.prototype.getOrInsertComputed is a TC39 stage-3 proposal pdf.js already relies on.
interface UpsertMap<K, V> extends Map<K, V> {
  getOrInsertComputed?: (key: K, fn: (key: K) => V) => V;
}

interface CaretDocument {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
}

/**
 * Must run before pdf.js is imported.
 * @usedBy webview/reader.ts (startReader)
 * @returns void
 */
export function installPolyfills(): void {
  const proto = Map.prototype as UpsertMap<unknown, unknown>;
  if (!proto.getOrInsertComputed) {
    Object.defineProperty(Map.prototype, "getOrInsertComputed", {
      value<K, V>(this: Map<K, V>, key: K, fn: (key: K) => V): V {
        if (this.has(key)) { return this.get(key) as V; }
        const v = fn(key);
        this.set(key, v);
        return v;
      },
      configurable: true,
      writable: true,
    });
  }
  const doc = document as unknown as CaretDocument;
  if (!doc.caretRangeFromPoint && doc.caretPositionFromPoint) {
    const fromPosition = doc.caretPositionFromPoint.bind(document);
    doc.caretRangeFromPoint = (x: number, y: number): Range | null => {
      const pos = fromPosition(x, y);
      if (!pos) { return null; }
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    };
  }
}
