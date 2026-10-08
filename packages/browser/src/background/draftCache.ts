/**
 * Keeps capture drafts between the calls that confirm a save, so the second
 * call reuses the record and the PDF search already run:
 *   - tab drafts (the popup's inspect → findPdf → save), keyed by tab id;
 *   - Scholar drafts (the button's save → "Save without PDF"), keyed by the
 *     result's composite identity, since Scholar has no tab to key on.
 * Both caches live in the background's memory: when the browser suspends the
 * service worker they are simply rebuilt on the next call. Scholar hits are
 * untrusted page data, so that cache is size-capped as well as TTL-bounded.
 * @depends capture/index
 * @dependents background/index
 */
import { draftFromScholarHit, inspectTab } from "../capture/index";
import type { CaptureDraft } from "../capture/index";
import type { ScholarHit } from "../platform/runtimeMessages";

const TTL_MS = 10 * 60_000;
const SCHOLAR_MAX = 64;

interface Entry {
  url: string;
  at: number;
  draft: Promise<CaptureDraft>;
}

const entries = new Map<number, Entry>();
const scholarEntries = new Map<string, { at: number; draft: Promise<CaptureDraft> }>();

/**
 * The tab's draft, inspected once per URL and reused for TTL_MS.
 * @usedBy background/index
 */
export function draftForTab(tabId: number, url: string, fresh = false): Promise<CaptureDraft> {
  const now = Date.now();
  for (const [id, e] of entries) if (now - e.at > TTL_MS) entries.delete(id);
  const hit = entries.get(tabId);
  if (!fresh && hit && hit.url === url) return hit.draft;
  const draft = inspectTab(tabId, url);
  entries.set(tabId, { url, at: now, draft });
  // A failed inspect must not be served again.
  draft.catch(() => { if (entries.get(tabId)?.draft === draft) entries.delete(tabId); });
  return draft;
}

/** Forgets a tab's draft (closed tab, or a save that changed the library). */
export function forgetDraft(tabId: number): void {
  entries.delete(tabId);
}

/**
 * A Scholar result's cache key. hit.key falls back to the title, so the links
 * are part of the identity: two results that share a title but link to
 * different papers must not collide.
 * @usedBy scholarDraftFor, tests
 */
export function scholarCacheKey(hit: ScholarHit): string {
  return JSON.stringify([hit.key, hit.url ?? "", hit.pdfUrl ?? "", hit.title]);
}

/**
 * The Scholar result's draft, built once and reused for TTL_MS, so the
 * "Save without PDF" confirmation reuses the finished search instead of
 * re-fetching the landing page and re-running the whole chain.
 * @usedBy background/index (scholar.save)
 */
export function scholarDraftFor(hit: ScholarHit): Promise<CaptureDraft> {
  const now = Date.now();
  for (const [k, e] of scholarEntries) if (now - e.at > TTL_MS) scholarEntries.delete(k);
  const key = scholarCacheKey(hit);
  const cached = scholarEntries.get(key);
  if (cached) return cached.draft;
  const draft = draftFromScholarHit(hit);
  scholarEntries.set(key, { at: now, draft });
  // A failed build must not be served again.
  draft.catch(() => { if (scholarEntries.get(key)?.draft === draft) scholarEntries.delete(key); });
  // Bound the cache: the hit is untrusted page data.
  for (const oldest of scholarEntries.keys()) {
    if (scholarEntries.size <= SCHOLAR_MAX) break;
    scholarEntries.delete(oldest);
  }
  return draft;
}

/** Clears the "already in library" mark of drafts pointing at a removed paper. */
export function forgetPaper(paperId: string): void {
  const clear = (d: CaptureDraft): void => { if (d.existing?.id === paperId) delete d.existing; };
  for (const entry of entries.values()) {
    void entry.draft.then(clear).catch(() => undefined);
  }
  for (const entry of scholarEntries.values()) {
    void entry.draft.then(clear).catch(() => undefined);
  }
}
