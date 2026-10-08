/**
 * File operations the cross-process sync lock needs; the app supplies the adapter.
 */
/** Minimal file operations the lock needs; the create must be atomic (O_EXCL). */
export interface LockStore {
  /**
   * Creates the file with the given text, complete, in one step (e.g. write a temp file, then link() it into place);
   * resolves false when it already exists. A reader must never see the file empty or half written.
   */
  createExclusive(path: string, text: string): Promise<boolean>;
  /** The file's text, or undefined when it does not exist. */
  read(path: string): Promise<string | undefined>;
  write(path: string, text: string): Promise<void>;
  /** Removes the file; a missing file is not an error. */
  remove(path: string): Promise<void>;
}
