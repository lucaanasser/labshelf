import * as vscode from "vscode";
import { resolveModelPaths } from "../../../src/ai/runtime/modelPaths";

describe("resolveModelPaths", () => {
  it("namespaces models under the global storage directory", () => {
    const paths = resolveModelPaths(vscode.Uri.file("/tmp/storage"), "Xenova/bge-small-en-v1.5");
    expect(paths.root.fsPath).toContain("models");
    expect(paths.root.fsPath).toContain("Xenova__bge-small-en-v1.5");
    expect(paths.manifest.fsPath.endsWith("labshelf.manifest.json")).toBe(true);
  });

  it("resolves relative file URIs under the root", () => {
    const paths = resolveModelPaths(vscode.Uri.file("/tmp/storage"), "model");
    const onnx = paths.fileUri("onnx/model.onnx");
    expect(onnx.fsPath.endsWith("onnx/model.onnx")).toBe(true);
  });
});
