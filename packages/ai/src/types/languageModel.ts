/**
 * Optional LLM contract reserved for Phase 2 (Copilot tier via vscode.lm).
 * Declared in Phase 0 so heuristic features can degrade gracefully when no LLM
 * is available, and so feature code can target a single interface later.
 *
 * @depends none
 * @dependents (phase 2) vscode.lm wrapper, agentic tier
 */
export interface LanguageModelOptions {
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface ILanguageModel {
  readonly providerId: string;
  complete(prompt: string, options?: LanguageModelOptions): Promise<string>;
  stream(prompt: string, options?: LanguageModelOptions): AsyncIterable<string>;
}
