/**
 * Imports that start from the network: an identifier (DOI, arXiv, PMID, ISBN) resolved through the registries, or the
 * URL of a PDF. Both write through the core mutation context.
 */
import {
  claimCiteKey,
  describeError,
  importPdf,
  makeCiteKey,
  metadataFields,
  normalizeTitle,
  resolveOnlineMetadata,
  PDF_FILE,
  type DetectedIdentifier,
  type ImportDeps,
  type ImportOutcome,
  type MutationContext,
  type PaperRecord,
  type ResolvedMetadata,
} from "@labshelf/core";
import * as path from "node:path";

import { identifiersIn } from "./importInputs.js";

export interface NetworkImportEnv {
  ctx: MutationContext;
  tmpDir: string;
  /** Read at each import, so it reflects the papers the earlier imports added. */
  importDeps(): ImportDeps;
  fetch?: typeof fetch;
  /** Network metadata lookup; injectable for tests. */
  resolveIdentifier?: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>;
}

const PDF_MAGIC = "%PDF-";
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const MODULE = "terminal/paperService";

/**
 * Imports a paper from an identifier or a URL containing one. arXiv papers come with their PDF; others are saved as a
 * reference without a PDF, like the browser extension does.
 * @returns what happened
 */
export async function importIdentifier(env: NetworkImportEnv, input: string, targetDir: string): Promise<ImportOutcome> {
  const identifiers = identifiersIn(input);
  if (!identifiers.length) { return { status: "failed", error: "No DOI, arXiv id, PMID or ISBN found", input }; }
  try {
    const found = await firstResolved(env, identifiers);
    if (!found) {
      return { status: "failed", error: `Could not find ${identifiers[0]!.type.toUpperCase()} ${identifiers[0]!.value}`, input };
    }
    const { metadata, identifier } = found;
    const deps = env.importDeps();
    const doi = metadata.doi ?? (identifier.type === "doi" ? identifier.value : undefined);
    const existingId = doi ? deps.findByDoi(doi) : undefined;
    if (existingId) { return { status: "duplicate", existingId, input }; }

    const pdf = identifier.type === "arxiv" ? await download(env, `https://arxiv.org/pdf/${identifier.value}`).catch(() => undefined) : undefined;
    const title = normalizeTitle(metadata.title!);
    const id = await claimCiteKey(
      makeCiteKey({ ...metadata, title }, title),
      deps.takenIds(),
      (key) => env.ctx.fs.exists(env.ctx.paths.join(targetDir, key)),
    );
    const folder = env.ctx.paths.join(targetDir, id);
    await env.ctx.fs.mkdir(folder);
    if (pdf) { await env.ctx.fs.writeFile(env.ctx.paths.join(folder, PDF_FILE), pdf); }
    const record: PaperRecord = {
      id, title, path: folder, citeKey: id, status: "unread", hasPdf: Boolean(pdf),
      ...metadataFields(metadata),
      ...(identifier.type === "doi" && !metadata.doi ? { doi: identifier.value } : {}),
      ...(identifier.type === "arxiv" && !metadata.url ? { url: `https://arxiv.org/abs/${identifier.value}` } : {}),
    };
    const { hasPdf: _hasPdf, ...stored } = record;
    await env.ctx.artifacts.writePaperArtifacts(folder, stored, identifier.type === "arxiv" ? `${identifier.value}.pdf` : PDF_FILE);
    await env.ctx.logger.log("INFO", MODULE, "Paper imported from identifier", {
      id, type: identifier.type, value: identifier.value, withPdf: Boolean(pdf), targetDir,
    });
    return { status: "added", record, needsReview: false, input };
  } catch (error) {
    const message = describeError(error).message;
    await env.ctx.logger.log("WARN", MODULE, "Identifier import failed", { input, message });
    return { status: "failed", error: message, input };
  }
}

/**
 * Downloads a PDF and imports it under the name in the URL.
 * @returns what happened
 */
export async function importUrl(env: NetworkImportEnv, url: string, targetDir: string): Promise<ImportOutcome> {
  const { ctx } = env;
  let tmp: string | undefined;
  try {
    const bytes = await download(env, url);
    tmp = path.join(env.tmpDir, `download-${Date.now()}.pdf`);
    await ctx.fs.ensureDir(env.tmpDir);
    await ctx.fs.writeFile(tmp, bytes);
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download.pdf");
    return await importPdf(ctx, env.importDeps(), tmp, targetDir, {
      sourceName: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`,
    });
  } catch (error) {
    const message = describeError(error).message;
    await ctx.logger.log("WARN", MODULE, "URL import failed", { url, message });
    return { status: "failed", error: message, input: url };
  } finally {
    if (tmp) { await ctx.fs.deleteFile(tmp).catch(() => undefined); }
  }
}

async function firstResolved(
  env: NetworkImportEnv,
  identifiers: DetectedIdentifier[],
): Promise<{ metadata: ResolvedMetadata; identifier: DetectedIdentifier } | undefined> {
  const resolve = env.resolveIdentifier ?? resolveOnlineMetadata;
  for (const identifier of identifiers) {
    const metadata = await resolve(identifier).catch(() => undefined);
    if (metadata?.title) { return { metadata, identifier }; }
  }
  return undefined;
}

// Checks the magic bytes so an HTML landing page is never saved as paper.pdf.
async function download(env: NetworkImportEnv, url: string): Promise<Uint8Array> {
  const doFetch = env.fetch ?? fetch;
  const response = await doFetch(url, { redirect: "follow", headers: { "User-Agent": "LabShelf-Terminal/0.1" } });
  if (!response.ok) { throw new Error(`Download failed: HTTP ${response.status}`); }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) { throw new Error("The file is too large"); }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== PDF_MAGIC) { throw new Error("The URL did not return a PDF"); }
  return bytes;
}
