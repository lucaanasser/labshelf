/**
 * Reading status of a paper and its runtime list.
 */
export const PAPER_STATUSES = ["unread", "reading", "done"] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

export function isPaperStatus(value: unknown): value is PaperStatus {
  return (PAPER_STATUSES as readonly unknown[]).includes(value);
}
