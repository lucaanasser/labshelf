/**
 * F13 — Code-repo discovery. Extracts GitHub and GitLab repository URLs.
 * Status fields are left undefined; the consumer (vscode repoHealthChecker)
 * fills them in via background HTTP checks.
 *
 * @depends ../types/metadata.ts
 * @dependents pipeline/ingestionStages.ts
 */
import type { CodeRepoRef } from "../types/metadata.js";

const GITHUB = /https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)/gi;
const GITLAB = /https?:\/\/(?:www\.)?gitlab\.com\/([\w.-]+\/[\w.-]+)/gi;

/**
 * Returns unique code repository references found in the text.
 *
 * @usedBy ingestionStages
 * @returns De-duplicated repos with provider tagged but status unknown.
 */
export function extractCodeRepos(text: string): CodeRepoRef[] {
  if (!text) return [];
  const seen = new Map<string, CodeRepoRef>();
  for (const match of text.matchAll(GITHUB)) {
    const slug = match[1];
    if (!slug) continue;
    const url = normalizeRepo(`https://github.com/${slug}`);
    seen.set(url, { url, provider: "github", status: "unknown" });
  }
  for (const match of text.matchAll(GITLAB)) {
    const slug = match[1];
    if (!slug) continue;
    const url = normalizeRepo(`https://gitlab.com/${slug}`);
    seen.set(url, { url, provider: "gitlab", status: "unknown" });
  }
  return Array.from(seen.values());
}

function normalizeRepo(url: string): string {
  return url.replace(/[).,;]+$/, "").replace(/\/$/, "");
}
