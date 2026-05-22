/**
 * Domain types describing a paper record and its reading status.
 *
 * @depends none
 * @dependents types/batchImport.ts, interfaces/database.ts, @labshelf/vscode, @labshelf/browser
 */
export type PaperStatus = "unread" | "reading" | "done";

export interface PaperRecord {
  id: string;
  title: string;
  authors?: string[];
  year?: number;
  path: string;
  citeKey: string;
  status: PaperStatus;
  summary?: string;
  // Bibliographic metadata populated via CrossRef / arXiv when a DOI/ID is found
  journal?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  issn?: string;
  language?: string;
}
