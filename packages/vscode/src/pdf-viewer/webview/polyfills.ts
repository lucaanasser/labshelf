/**
 * Runtime polyfills pdf.js 6 needs inside the VS Code webview's Chromium.
 *
 * @depends none
 * @dependents pdf-viewer/webview/main.ts
 */

// Map.prototype.getOrInsertComputed is a TC39 stage-3 proposal pdf.js already relies on.
interface UpsertMap<K, V> extends Map<K, V> {
  getOrInsertComputed?: (key: K, fn: (key: K) => V) => V;
}

/**
 * Must run before pdf.js is imported.
 * @usedBy pdf-viewer/webview/main.ts
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
}
