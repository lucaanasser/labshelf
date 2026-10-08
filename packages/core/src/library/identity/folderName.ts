/** The one rule for the name of a collection folder, shared by every app. */

export const FOLDER_NAME_MAX_LENGTH = 255;

/** @returns an error message for the trimmed name, or undefined when it is valid */
export function validateFolderName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) { return "The name cannot be empty."; }
  if (trimmed.length > FOLDER_NAME_MAX_LENGTH) {
    return `The name is too long (at most ${FOLDER_NAME_MAX_LENGTH} characters).`;
  }
  if (/[/\\]/.test(trimmed)) { return "Use a name without slashes."; }
  if (trimmed.startsWith(".")) { return "A collection name cannot start with a dot."; }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) { return "The name contains control characters."; }
  return undefined;
}
