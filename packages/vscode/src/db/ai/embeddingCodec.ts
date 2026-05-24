/**
 * Encodes and decodes Float32Array embeddings to/from the SQLite BLOB column.
 *
 * @depends none
 * @dependents db/ai/sqliteVectorStore.ts, db/ai/figureVectorStore.ts
 */

/**
 * Serialises a Float32Array into a Buffer suitable for a SQLite BLOB column.
 *
 * @usedBy SqliteVectorStore.upsert
 * @returns Buffer view referencing the same underlying memory.
 */
export function encodeEmbedding(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Deserialises a BLOB column into a Float32Array of `dim` components.
 *
 * @usedBy SqliteVectorStore.search
 * @returns Float32Array view over the buffer.
 */
export function decodeEmbedding(blob: Uint8Array, dim: number): Float32Array {
  const expected = dim * 4;
  if (blob.byteLength !== expected) {
    throw new Error(
      `decodeEmbedding: blob is ${blob.byteLength} bytes but dim=${dim} expects ${expected}`,
    );
  }
  return new Float32Array(blob.buffer, blob.byteOffset, dim);
}
