/**
 * Options page bootstrap. Phase 1 only renders the recent log buffer captured
 * by BrowserLogger so we can confirm the storage ring works end to end.
 * @depends platform/browserApi, platform/logger.
 * @dependents options/index.html.
 */
import { BrowserLogger } from "../platform/logger";

const logger = new BrowserLogger("options");

async function renderLog(): Promise<void> {
  const target = document.getElementById("log");
  if (!target) return;
  const entries = await logger.recent();
  if (entries.length === 0) {
    target.textContent = "(no log entries yet)";
    return;
  }
  target.textContent = entries
    .map((e) => `${e.timestamp} [${e.level}] (${e.module}) ${e.message}`)
    .join("\n");
}

void renderLog();
