/**
 * Computes a stable SHA-256 hex digest of file content via Web Crypto, so the
 * same routine runs under Node 20+, Electron, and browser extension contexts.
 *
 * @depends none (uses globalThis.crypto.subtle)
 * @dependents sync/core/treeScan, sync/core/syncApply
 */

const HEX = "0123456789abcdef";

/**
 * Returns the lowercase hex SHA-256 digest of the given bytes.
 * @usedBy treeScan, syncApply
 * @returns Promise<string>
 */
export async function sha256Hex(content: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", content as BufferSource);
  const view = new Uint8Array(buffer);
  let out = "";
  for (const byte of view) {
    out += HEX[(byte >> 4) & 0x0f]! + HEX[byte & 0x0f]!;
  }
  return out;
}
