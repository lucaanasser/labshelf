/** The file-system port library mutations write through: text and byte access plus folder rename, creation and trash. */
import type { IFileSystem } from "./fileSystem.js";
import type { LocalFileSystem } from "./localFileSystem.js";

export interface LibraryFileSystem extends IFileSystem, LocalFileSystem {
  /** Fails when the destination exists, except for a rename that changes only letter case; callers check first. */
  rename(from: string, to: string): Promise<void>;
  /** Moves to the platform trash where one exists, deletes permanently otherwise. */
  trash(target: string): Promise<void>;
  /** Creates a folder that exists even while it is empty (the browser store keeps a marker for it). */
  mkdir(dir: string): Promise<void>;
}
