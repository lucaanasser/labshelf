/**
 * Where a platform keeps one sidecar (data.json) per paper.
 */
export interface SidecarPort {
  /** The sidecar text, or null when the paper has none yet. */
  read(paperId: string): Promise<string | null>;
  write(paperId: string, text: string): Promise<void>;
}
