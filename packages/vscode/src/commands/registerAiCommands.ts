/**
 * Registers AI-namespaced commands (labshelf.ai.*). The handler closures
 * resolve the AiService lazily via getter so commands remain valid even when
 * the service is created after activation (e.g. when the library is set up).
 *
 * @depends vscode, ai/service/aiService
 * @dependents extension.ts
 */
import * as vscode from "vscode";
import type { AiService } from "../ai/service/aiService.js";

export type AiServiceProvider = () => AiService | null;

const REQUIRED_MESSAGE = "LabShelf AI is not available. Configure a library and ensure AI is enabled in settings.";

/**
 * Registers labshelf.ai.rebuildIndex, labshelf.ai.searchByClaim,
 * labshelf.ai.searchByText, and labshelf.ai.openSettings.
 *
 * @usedBy extension.ts activate()
 * @returns void
 */
export function registerAiCommands(
  context: vscode.ExtensionContext,
  getAiService: AiServiceProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.ai.rebuildIndex", async () => {
      const service = getAiService();
      if (!service) {
        vscode.window.showWarningMessage(REQUIRED_MESSAGE);
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "LabShelf: rebuilding AI index" },
        async () => {
          await service.rebuildAll();
        },
      );
    }),
    vscode.commands.registerCommand("labshelf.ai.searchByClaim", async () => {
      const service = getAiService();
      if (!service) {
        vscode.window.showWarningMessage(REQUIRED_MESSAGE);
        return;
      }
      const claim = await vscode.window.showInputBox({
        prompt: "Enter a claim. Results will be classified as support / contradict / neutral.",
        placeHolder: "transformers scale better than RNNs in long contexts",
      });
      if (!claim) return;
      const results = await service.searchByClaim(claim);
      if (results.length === 0) {
        vscode.window.showInformationMessage("LabShelf AI: no relevant evidence found.");
        return;
      }
      showClaimResults(claim, results);
    }),
    vscode.commands.registerCommand("labshelf.ai.searchByText", async () => {
      const service = getAiService();
      if (!service) {
        vscode.window.showWarningMessage(REQUIRED_MESSAGE);
        return;
      }
      const query = await vscode.window.showInputBox({
        prompt: "Semantic search across your library",
      });
      if (!query) return;
      const results = await service.searchByText(query, 10);
      const items = results.map((m) => ({
        label: m.text ? m.text.slice(0, 120) : `(${m.kind})`,
        description: `paper:${m.paperId} score:${m.score.toFixed(3)}`,
      }));
      await vscode.window.showQuickPick(items, { placeHolder: `${results.length} matches` });
    }),
    vscode.commands.registerCommand("labshelf.ai.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "labshelf.ai");
    }),
  );
}

function showClaimResults(
  claim: string,
  results: Awaited<ReturnType<AiService["searchByClaim"]>>,
): void {
  const grouped = {
    support: results.filter((r) => r.stance === "support"),
    contradict: results.filter((r) => r.stance === "contradict"),
    neutral: results.filter((r) => r.stance === "neutral"),
  };
  const summary = `Claim: ${claim}\n  support: ${grouped.support.length}\n  contradict: ${grouped.contradict.length}\n  neutral: ${grouped.neutral.length}`;
  vscode.window.showInformationMessage(summary);
}
