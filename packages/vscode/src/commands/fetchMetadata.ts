/**
 * Resolves a paper's bibliographic record from something the user types — a
 * DOI, an arXiv id, a PMID, a publisher URL, or just the title. This is the
 * escape hatch for PDFs the automatic pipeline cannot recognise, such as scans
 * too poor for OCR or papers no registry indexes.
 *
 * @depends vscode, @labshelf/core, core/paperService
 * @dependents commands/registerCommands.ts
 */
import * as vscode from "vscode";

import {
  detectIdentifiers,
  resolveFirstIdentifier,
  searchOnlineCandidates,
} from "@labshelf/core";
import type { PaperRecord, ResolvedMetadata } from "@labshelf/core";
import type { PaperService } from "../core/paperService.js";

/**
 * Asks the user how to identify the paper, resolves it online, and writes the
 * result back to the library.
 * @usedBy commands/registerCommands.ts
 * @returns The updated paper, or undefined when the user cancelled or nothing matched.
 */
export async function fetchMetadataForPaper(
  paperService: PaperService,
  paper: PaperRecord,
): Promise<PaperRecord | undefined> {
  const query = await vscode.window.showInputBox({
    title: `Fetch metadata — ${paper.title}`,
    prompt: "Paste a DOI, arXiv id, PMID, publisher link, or type the paper's title",
    placeHolder: "10.7554/eLife.28383",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length < 4 ? "Enter a DOI, identifier, link, or title" : undefined),
  });

  if (!query?.trim()) {
    return undefined;
  }

  const found = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "LabShelf: looking up metadata…" },
    () => lookupUserQuery(query.trim()),
  );

  if (found.length === 0) {
    // Nothing online knows this paper — unpublished work, internal reports and
    // obscure venues all land here, so typing it in must stay possible.
    const choice = await vscode.window.showWarningMessage(
      `LabShelf: no record matched "${truncate(query.trim(), 60)}".`,
      "Enter manually",
      "Try again",
      "Cancel",
    );
    if (choice === "Try again") {
      return fetchMetadataForPaper(paperService, paper);
    }
    if (choice === "Enter manually") {
      return enterMetadataManually(paperService, paper, query.trim());
    }
    return undefined;
  }

  // A confirmed identifier is unambiguous; a title search is not, so let the
  // user pick between works that match the words they typed equally well.
  const metadata = found.length === 1 ? found[0]! : await pickCandidate(found);
  if (!metadata) {
    return undefined;
  }

  const updated = await paperService.applyResolvedMetadata(paper.id, metadata);
  if (updated) {
    await vscode.window.showInformationMessage(`LabShelf: updated "${truncate(updated.title, 70)}".`);
  }
  return updated;
}

/**
 * Turns free-form user input into candidate records, preferring an identifier
 * it can confirm over a title it can only search for.
 * @usedBy commands/fetchMetadata.ts
 * @returns One confirmed record, several candidates, or an empty list.
 */
export async function lookupUserQuery(query: string): Promise<ResolvedMetadata[]> {
  // A pasted link counts as both text and a link target.
  const identifiers = detectIdentifiers({}, query, [query]);
  if (identifiers.length > 0) {
    const confirmed = await resolveFirstIdentifier(identifiers).catch(() => undefined);
    if (confirmed) {
      return [confirmed.metadata];
    }
  }

  return searchOnlineCandidates(query).catch(() => []);
}

/**
 * Collects the record by hand. The genuine last resort, for work no registry
 * indexes: unpublished manuscripts, internal reports, theses, lecture notes.
 * @usedBy commands/fetchMetadata.ts
 * @returns The updated paper, or undefined when the user cancelled.
 */
export async function enterMetadataManually(
  paperService: PaperService,
  paper: PaperRecord,
  titleHint?: string,
): Promise<PaperRecord | undefined> {
  const ask = async (
    field: string,
    prompt: string,
    value: string | undefined,
    step: number,
  ): Promise<string | undefined> =>
    vscode.window.showInputBox({
      title: `Paper details (${step}/6) — ${field}`,
      prompt,
      value: value ?? "",
      ignoreFocusOut: true,
    });

  // The title is the only field worth refusing to continue without.
  const title = await ask("Title", "Title of the paper", titleHint ?? paper.title, 1);
  if (title === undefined || !title.trim()) {
    return undefined;
  }

  const authors = await ask("Authors", "Authors, separated by ';'", paper.authors?.join("; "), 2);
  if (authors === undefined) {
    return undefined;
  }
  const year = await ask("Year", "Publication year", paper.year ? String(paper.year) : undefined, 3);
  if (year === undefined) {
    return undefined;
  }
  const journal = await ask("Journal", "Journal, conference, or publisher", paper.journal, 4);
  if (journal === undefined) {
    return undefined;
  }
  const doi = await ask("DOI", "DOI or URL (optional)", paper.doi, 5);
  if (doi === undefined) {
    return undefined;
  }
  const keywords = await ask("Keywords", "Keywords, separated by ',' (optional)", paper.keywords?.join(", "), 6);
  if (keywords === undefined) {
    return undefined;
  }

  const parsedYear = Number.parseInt(year.trim(), 10);
  const metadata: ResolvedMetadata = {
    title: title.trim(),
    ...(authors.trim() ? { authors: splitList(authors, ";") } : {}),
    ...(Number.isFinite(parsedYear) ? { year: parsedYear } : {}),
    ...(journal.trim() ? { journal: journal.trim() } : {}),
    ...(doi.trim() ? doiOrUrl(doi.trim()) : {}),
    ...(keywords.trim() ? { keywords: splitList(keywords, ",") } : {}),
  };

  const updated = await paperService.applyResolvedMetadata(paper.id, metadata);
  if (updated) {
    await vscode.window.showInformationMessage(`LabShelf: saved "${truncate(updated.title, 70)}".`);
  }
  return updated;
}

function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Accepts either form in the DOI box, since users paste whichever they have.
function doiOrUrl(value: string): ResolvedMetadata {
  const doi = value.match(/10\.\d{4,9}\/\S+/)?.[0];
  if (doi) {
    return { doi, url: `https://doi.org/${doi}` };
  }
  return /^https?:\/\//i.test(value) ? { url: value } : {};
}

// Shows the matches so the user can confirm which work this PDF actually is.
async function pickCandidate(candidates: ResolvedMetadata[]): Promise<ResolvedMetadata | undefined> {
  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.title ?? "Untitled",
      description: [candidate.year, candidate.journal].filter(Boolean).join(" · "),
      detail: [candidate.authors?.slice(0, 4).join(", "), candidate.doi].filter(Boolean).join("  —  "),
      candidate,
    })),
    { title: "Which paper is this?", placeHolder: "Select the matching record", matchOnDetail: true },
  );
  return picked?.candidate;
}

/**
 * Re-runs extraction over every paper no registry ever confirmed, then offers
 * a manual lookup for whatever is still unidentified. This is the recovery
 * path after importing offline or before the pipeline could resolve a source.
 * @usedBy commands/registerCommands.ts
 * @returns void
 */
export async function resolveMissingMetadata(paperService: PaperService): Promise<void> {
  const pending = await paperService.listUnresolvedPapers();
  if (pending.length === 0) {
    await vscode.window.showInformationMessage("LabShelf: every paper already has a confirmed record.");
    return;
  }

  const recovered: PaperRecord[] = [];
  const stillUnknown: PaperRecord[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "LabShelf: resolving metadata",
      cancellable: true,
    },
    async (progress, token) => {
      for (const [index, paper] of pending.entries()) {
        if (token.isCancellationRequested) {
          return;
        }
        progress.report({
          message: `${index + 1}/${pending.length} — ${truncate(paper.title, 40)}`,
          increment: 100 / pending.length,
        });

        const updated = await paperService.refreshMetadataFromPdf(paper.id).catch(() => undefined);
        (updated ? recovered : stillUnknown).push(updated ?? paper);
      }
    },
  );

  if (recovered.length > 0) {
    await vscode.window.showInformationMessage(
      `LabShelf: recovered metadata for ${recovered.length} of ${pending.length} paper${pending.length === 1 ? "" : "s"}.`,
    );
  }
  await offerMetadataFetch(paperService, stillUnknown);
}

/**
 * Offers to look metadata up for papers the importer could not identify.
 * @usedBy commands/registerCommands.ts
 * @returns void
 */
export async function offerMetadataFetch(
  paperService: PaperService,
  papers: PaperRecord[],
): Promise<void> {
  if (papers.length === 0) {
    return;
  }

  const subject =
    papers.length === 1
      ? `"${truncate(papers[0]!.title, 50)}"`
      : `${papers.length} papers`;
  const choice = await vscode.window.showWarningMessage(
    `LabShelf could not identify ${subject}. Fill in the details now?`,
    "Look up",
    "Enter manually",
    "Later",
  );
  if (choice !== "Look up" && choice !== "Enter manually") {
    return;
  }

  for (const paper of papers) {
    await (choice === "Look up"
      ? fetchMetadataForPaper(paperService, paper)
      : enterMetadataManually(paperService, paper));
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
