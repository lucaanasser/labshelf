/** Cite keys: "authorYearWord" generation and collision-free claiming (the key is the paper id and folder name). */

// Title words that make a poor cite-key suffix.
const STOPWORDS = new Set(["a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "from", "by", "at", "is", "are"]);

export interface CiteKeyMetadata {
  authors?: string[] | undefined;
  year?: number | undefined;
  title?: string | undefined;
}

/** Lower-cased text reduced to ASCII letters and digits. */
export function citeKeySlug(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "authorYearWord" cite key (vaswani2017attention); a timestamp key when the metadata has nothing to build from. */
export function makeCiteKey(meta: CiteKeyMetadata, fallbackTitle: string): string {
  const lastName = citeKeySlug(meta.authors?.[0]?.trim().split(/\s+/).pop() ?? "");
  const year = meta.year ? String(meta.year) : "";
  const word = (meta.title ?? fallbackTitle)
    .split(/\s+/)
    .map(citeKeySlug)
    .find((w) => w.length > 1 && !STOPWORDS.has(w)) ?? "";
  return `${lastName}${year}${word}` || `paper${Date.now()}`;
}

/**
 * The key when free, otherwise key + a, b, … z, aa, … (BibTeX's convention). Comparison ignores case because the key
 * is a folder name and drives may fold case.
 */
export function uniqueCiteKey(base: string, taken: ReadonlySet<string>): string {
  const takenLower = new Set([...taken].map((key) => key.toLowerCase()));
  if (!takenLower.has(base.toLowerCase())) { return base; }
  for (let i = 0; i < 26 * 26; i++) {
    const suffix = i < 26
      ? String.fromCharCode(97 + i)
      : String.fromCharCode(97 + Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26));
    if (!takenLower.has(`${base}${suffix}`.toLowerCase())) { return `${base}${suffix}`; }
  }
  return `${base}${Date.now()}`;
}

/**
 * A key free among the known ids and on disk. A folder can exist without being a known paper (a sync in flight, an
 * orphan PDF folder), so each candidate is also checked with `folderExists`.
 */
export async function claimCiteKey(
  base: string,
  takenIds: Iterable<string>,
  folderExists: (key: string) => Promise<boolean>,
): Promise<string> {
  const taken = new Set([...takenIds].map((id) => id.toLowerCase()));
  let key = uniqueCiteKey(base, taken);
  while (await folderExists(key)) {
    taken.add(key.toLowerCase());
    key = uniqueCiteKey(base, taken);
  }
  return key;
}
