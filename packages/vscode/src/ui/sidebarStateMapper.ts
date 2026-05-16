/**
 * Module: Sidebar State Mapper
 * Responsibility: Project PaperRecord[] into a serializable view model for the sidebar webview
 * Dependencies: core types
 */
import type { PaperRecord, PaperStatus } from "../core/types.js";

export interface SidebarPaperViewModel {
  id: string;
  title: string;
  citeKey: string;
  year?: number;
  path: string;
  status: PaperStatus;
  statusLabel: string;
  initials: string;
}

export interface SidebarCountsViewModel {
  all: number;
  unread: number;
  reading: number;
  done: number;
  recent: number;
}

export interface SidebarViewModel {
  papers: SidebarPaperViewModel[];
  counts: SidebarCountsViewModel;
  generatedAt: string;
}

const STATUS_LABEL: Record<PaperStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  done: "Done",
};

export function mapPapersToViewModel(papers: PaperRecord[]): SidebarViewModel {
  const projected = papers.map(projectPaper);
  return {
    papers: projected,
    counts: {
      all: projected.length,
      unread: projected.filter((paper) => paper.status === "unread").length,
      reading: projected.filter((paper) => paper.status === "reading").length,
      done: projected.filter((paper) => paper.status === "done").length,
      recent: Math.min(projected.length, 10),
    },
    generatedAt: new Date().toISOString(),
  };
}

function projectPaper(paper: PaperRecord): SidebarPaperViewModel {
  return {
    id: paper.id,
    title: paper.title,
    citeKey: paper.citeKey,
    path: paper.path,
    status: paper.status,
    statusLabel: STATUS_LABEL[paper.status] ?? paper.status,
    initials: deriveInitials(paper.title),
    ...(paper.year !== undefined ? { year: paper.year } : {}),
  };
}

function deriveInitials(title: string): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word[0] ?? ""));

  if (words.length === 0) {
    return "··";
  }

  const first = words[0] ?? "";
  if (words.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }

  const second = words[1] ?? "";
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}
