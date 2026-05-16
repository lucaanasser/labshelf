/** Computes a stable SHA-256 hex digest of file content. @depends node:crypto. @dependents treeScan, syncApply */
import { createHash } from "node:crypto";

/** Returns the lowercase hex SHA-256 digest of the given bytes. @usedBy treeScan, syncApply. @returns string */
export function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
