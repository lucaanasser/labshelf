/**
 * Module: Content Hash
 * Responsibility: Compute a stable SHA-256 hex digest of file content
 * Dependencies: node:crypto
 */
import { createHash } from "node:crypto";

/** Returns the lowercase hex SHA-256 digest of the given bytes. */
export function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
