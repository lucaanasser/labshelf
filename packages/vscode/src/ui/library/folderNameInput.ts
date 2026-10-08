/** The input-box validator for folder names, in the shape vscode.InputBoxOptions.validateInput expects. */
import { validateFolderName } from "@labshelf/core";

export function validateFolderNameInput(value: string): string | null {
  return validateFolderName(value) ?? null;
}
