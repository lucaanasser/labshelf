/**
 * Downloads ONNX models from HuggingFace into the extension's globalStorage.
 * Progress is surfaced via vscode.window.withProgress when called eagerly;
 * background calls emit a lifecycle event but stay silent in the status bar.
 *
 * Idempotent: an existing manifest with matching version short-circuits.
 *
 * @depends vscode, ./modelManifest.ts, ./modelPaths.ts
 * @dependents service/aiServiceFactory.ts
 */
import * as vscode from "vscode";
import type { ExtensionEventBus } from "@labshelf/core";
import { EVENTS } from "@labshelf/core";
import type { ModelDescriptor } from "./modelManifest.js";
import { resolveModelPaths } from "./modelPaths.js";

const MANIFEST_VERSION = 1;
const HF_BASE = "https://huggingface.co";

export interface ModelDownloaderDependencies {
  globalStorage: vscode.Uri;
  eventBus: ExtensionEventBus;
  fetchImpl?: typeof fetch;
}

interface OnDiskManifest {
  version: number;
  modelId: string;
  files: { name: string; size: number }[];
  downloadedAt: number;
}

export class ModelDownloader {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: ModelDownloaderDependencies) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  /**
   * Ensures all files declared in the descriptor exist locally.
   *
   * @usedBy aiServiceFactory
   * @returns Local root URI of the downloaded model.
   */
  async ensureModel(descriptor: ModelDescriptor): Promise<vscode.Uri> {
    const paths = resolveModelPaths(this.deps.globalStorage, descriptor.id);
    if (await this.hasValidManifest(paths.manifest, descriptor.id)) {
      this.deps.eventBus.emit(EVENTS.AI_MODEL_READY, { modelId: descriptor.id, cached: true });
      return paths.root;
    }
    await vscode.workspace.fs.createDirectory(paths.root);
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(`${paths.root.fsPath}/onnx`),
    );
    await this.downloadAll(descriptor, paths);
    await this.writeManifest(paths.manifest, descriptor);
    this.deps.eventBus.emit(EVENTS.AI_MODEL_READY, { modelId: descriptor.id, cached: false });
    return paths.root;
  }

  private async hasValidManifest(
    manifest: vscode.Uri,
    modelId: string,
  ): Promise<boolean> {
    try {
      const raw = await vscode.workspace.fs.readFile(manifest);
      const parsed = JSON.parse(Buffer.from(raw).toString("utf-8")) as OnDiskManifest;
      return parsed.version === MANIFEST_VERSION && parsed.modelId === modelId;
    } catch {
      return false;
    }
  }

  private async downloadAll(
    descriptor: ModelDescriptor,
    paths: ReturnType<typeof resolveModelPaths>,
  ): Promise<void> {
    const title = `Downloading ${descriptor.id}`;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      async (progress) => {
        let done = 0;
        for (const file of descriptor.files) {
          progress.report({ message: file, increment: 0 });
          await this.downloadFile(descriptor, file, paths);
          done += 1;
          progress.report({ increment: (1 / descriptor.files.length) * 100 });
        }
        progress.report({ message: `${done}/${descriptor.files.length}` });
      },
    );
  }

  private async downloadFile(
    descriptor: ModelDescriptor,
    relative: string,
    paths: ReturnType<typeof resolveModelPaths>,
  ): Promise<void> {
    const url = `${HF_BASE}/${descriptor.hfRepo}/resolve/main/${relative}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }
    const body = new Uint8Array(await response.arrayBuffer());
    const dest = paths.fileUri(relative);
    await vscode.workspace.fs.writeFile(dest, body);
  }

  private async writeManifest(
    manifest: vscode.Uri,
    descriptor: ModelDescriptor,
  ): Promise<void> {
    const data: OnDiskManifest = {
      version: MANIFEST_VERSION,
      modelId: descriptor.id,
      files: descriptor.files.map((name) => ({ name, size: 0 })),
      downloadedAt: Date.now(),
    };
    await vscode.workspace.fs.writeFile(
      manifest,
      Buffer.from(JSON.stringify(data, null, 2), "utf-8"),
    );
  }
}
