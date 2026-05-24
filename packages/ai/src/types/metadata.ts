/**
 * Structured AI-extracted metadata for a paper. Persisted by the consumer
 * (VSCode: paper_metadata_ai table) and produced by heuristics in this package.
 *
 * @depends none
 * @dependents heuristics/*, pipeline/ingestionStages, vscode aiService
 */

export interface CodeRepoRef {
  url: string;
  provider: "github" | "gitlab" | "other";
  status?: "active" | "missing" | "unknown";
  stars?: number;
  lastChecked?: number;
}

export interface ComputeDisclosure {
  acceleratorModel?: string;
  acceleratorCount?: number;
  trainingHours?: number;
  estimatedCostUsd?: number;
  rawSnippet?: string;
}

export interface ReproducibilityScore {
  score: number;
  hasCode: boolean;
  hasData: boolean;
  hasHyperparams: boolean;
  hasSeeds: boolean;
  hasHardwareDetails: boolean;
}

export interface AiPaperMetadata {
  paperId: string;
  methods: string[];
  datasets: string[];
  codeRepos: CodeRepoRef[];
  reproducibility: ReproducibilityScore;
  compute?: ComputeDisclosure;
  limitations: string[];
  difficultyProfile: Record<number, number>;
  indexedAt: number;
}
