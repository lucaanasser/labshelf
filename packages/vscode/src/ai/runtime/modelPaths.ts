/**
 * Resolves on-disk locations for AI model files inside the extension's
 * globalStorage. Files are namespaced per-model so multiple models can coexist
 * without manifest collisions.
 *
 * @depends vscode
 * @dependents runtime/modelDownloader.ts, runtime/onnxEmbeddingProvider.ts
 */
import * as path from "node:path";
import * as vscode from "vscode";

export interface ModelPaths {
  root: vscode.Uri;
  manifest: vscode.Uri;
  fileUri(relative: string): vscode.Uri;
}

/**
 * Returns the resolved paths for the given model id.
 *
 * @usedBy modelDownloader, onnxEmbeddingProvider
 * @returns ModelPaths with root, manifest URI, and per-file helper.
 */
export function resolveModelPaths(
  globalStorage: vscode.Uri,
  modelId: string,
): ModelPaths {
  const slug = modelId.replace(/[\\\/]/g, "__");
  const root = vscode.Uri.file(path.join(globalStorage.fsPath, "models", slug));
  return {
    root,
    manifest: vscode.Uri.file(path.join(root.fsPath, "labshelf.manifest.json")),
    fileUri: (relative) => vscode.Uri.file(path.join(root.fsPath, relative)),
  };
}
