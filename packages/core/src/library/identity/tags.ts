/** Tag list normalisation shared by every app. */

/** Trimmed, inner whitespace collapsed, blanks dropped, de-duplicated case-insensitively (first spelling wins), order kept. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}
