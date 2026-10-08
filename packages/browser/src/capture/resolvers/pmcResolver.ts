/**
 * Turns a known PMCID into open-access PDF candidates, in the order the research
 * (apis-A §2.4, §3.1) found most likely to download without a browser:
 *   1. the AWS Open Data bucket `pmc-oa-opendata`, which serves many PMC PDFs
 *      with no challenge (the key carries a version, so it is discovered by a
 *      cheap S3 list, parsed with a regex since the worker has no DOMParser);
 *   2. `https://pmc.ncbi.nlm.nih.gov/articles/PMC<n>/pdf/`, which answers a
 *      proof-of-work "Preparing to download" page — solvePmcPow() below produces
 *      the cookie that unlocks it, for the fetcher/helper to apply.
 *
 * The legacy `www.ncbi.nlm.nih.gov/pmc/...` form is deliberately never emitted:
 * it 404s today.
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

const S3_BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com";
const TIMEOUT_MS = 8000;

export const pmcResolver: PdfResolver = {
  name: "pmc",
  async resolve(ctx: ResolveContext): Promise<string[]> {
    const pmcid = normalizePmcid(ctx.pmcid);
    if (!pmcid) return [];
    const digits = pmcid.slice(3);

    const out: string[] = [];
    const key = await findS3Key(digits);
    if (key) out.push(`${S3_BUCKET}/${key}`);
    out.push(`https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/pdf/`);
    return out;
  },
};

/** Canonical "PMC1234567" from any PMCID spelling, or undefined when there is none. */
export function normalizePmcid(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /(\d{3,})/.exec(raw);
  return m?.[1] ? `PMC${m[1]}` : undefined;
}

// The trailing dot in the prefix is required, or "PMC118" also lists "PMC1180...".
// Keys look like "PMC1182327.2/PMC1182327.2.pdf"; pick the highest version.
async function findS3Key(digits: string): Promise<string | undefined> {
  const url = `${S3_BUCKET}/?list-type=2&prefix=PMC${digits}.&max-keys=100`;
  const xml = await getText(url, TIMEOUT_MS);
  if (!xml) return undefined;
  const re = new RegExp(`<Key>(PMC${digits}\\.(\\d+)/PMC${digits}\\.\\d+\\.pdf)</Key>`, "g");
  let best: { key: string; version: number } | undefined;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const key = m[1];
    const version = Number(m[2]);
    if (!key || Number.isNaN(version)) continue;
    if (!best || version > best.version) best = { key, version };
  }
  return best?.key;
}

/** Cookie name the PMC download page reads the solved proof-of-work from. */
export const PMC_POW_COOKIE_NAME = "cloudpmc-viewer-pow";

export interface PmcProofOfWork {
  nonce: number;
  hash: string;
  /** Raw cookie value: "<challenge>,<nonce>". */
  cookieValue: string;
  /** Ready-to-send Cookie header fragment with the value URI-encoded. */
  cookieHeader: string;
}

/**
 * Solves the PMC "Preparing to download" proof-of-work: find the smallest nonce
 * whose sha256(challenge + nonce) hex digest starts with `difficulty` zeros, and
 * build the `cloudpmc-viewer-pow` cookie the page then accepts (apis-A §2.4).
 *
 * UNVERIFIED offline: transcribed faithfully from the research's reading of the
 * page's bundled js-sha256 loop; it was not exercised against a live PMC page in
 * this build.
 * @usedBy the fetcher / helper tab, to unlock pmc.ncbi.nlm.nih.gov PDF URLs
 */
export function solvePmcPow(challenge: string, difficulty = 4): PmcProofOfWork {
  const target = "0".repeat(difficulty);
  const maxNonce = 1 << 24;
  for (let nonce = 0; nonce < maxNonce; nonce += 1) {
    const hash = sha256Hex(challenge + nonce);
    if (hash.startsWith(target)) {
      const cookieValue = `${challenge},${nonce}`;
      return { nonce, hash, cookieValue, cookieHeader: `${PMC_POW_COOKIE_NAME}=${encodeURIComponent(cookieValue)}` };
    }
  }
  throw new Error(`PMC proof-of-work not solved within ${maxNonce} nonces`);
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous SHA-256 hex digest of a UTF-8 string (fast enough for ~65k PoW hashes). */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(total - 4, bitLen >>> 0, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let i = 0; i < 64; i += 1) {
      const sig1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + sig1 + ch + (SHA256_K[i] as number) + (w[i] as number)) >>> 0;
      const sig0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (sig0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i += 1) hex += (h[i] as number).toString(16).padStart(8, "0");
  return hex;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

async function getText(url: string, timeoutMs: number): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    return await res.text();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
