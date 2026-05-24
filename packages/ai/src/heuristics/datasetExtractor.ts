/**
 * F12 — Dataset extraction. Matches a curated list of canonical benchmark
 * names. We avoid generic capitalization rules because they produce too many
 * false positives on author surnames and section titles.
 *
 * @depends none
 * @dependents pipeline/ingestionStages.ts, analysis/datasetIndex
 */

const DATASETS: { tag: string; pattern: RegExp }[] = [
  { tag: "ImageNet", pattern: /\bImageNet\b/ },
  { tag: "CIFAR-10", pattern: /\bCIFAR-?10\b/ },
  { tag: "CIFAR-100", pattern: /\bCIFAR-?100\b/ },
  { tag: "MNIST", pattern: /\bMNIST\b/ },
  { tag: "COCO", pattern: /\b(?:MS-?)?COCO\b/ },
  { tag: "GLUE", pattern: /\bGLUE\b/ },
  { tag: "SuperGLUE", pattern: /\bSuperGLUE\b/ },
  { tag: "SQuAD", pattern: /\bSQuAD\b/ },
  { tag: "WikiText", pattern: /\bWikiText(?:-\d+)?\b/ },
  { tag: "C4", pattern: /\bC4\b/ },
  { tag: "The Pile", pattern: /\bThe Pile\b/ },
  { tag: "MMLU", pattern: /\bMMLU\b/ },
  { tag: "HellaSwag", pattern: /\bHellaSwag\b/ },
  { tag: "ARC", pattern: /\bARC(?:-(?:Easy|Challenge))?\b/ },
  { tag: "TriviaQA", pattern: /\bTriviaQA\b/ },
  { tag: "MS-MARCO", pattern: /\bMS-?MARCO\b/ },
  { tag: "BEIR", pattern: /\bBEIR\b/ },
  { tag: "GSM8K", pattern: /\bGSM8K\b/ },
  { tag: "HumanEval", pattern: /\bHumanEval\b/ },
  { tag: "MBPP", pattern: /\bMBPP\b/ },
  { tag: "LAMBADA", pattern: /\bLAMBADA\b/ },
  { tag: "WMT", pattern: /\bWMT(?:'?\d{2})?\b/ },
  { tag: "PubMed", pattern: /\bPubMed\b/ },
  { tag: "OpenWebText", pattern: /\bOpenWebText\b/ },
  { tag: "LAION", pattern: /\bLAION(?:-\d+B?)?\b/ },
];

/**
 * Returns distinct canonical dataset names found in the paper's text.
 *
 * @usedBy ingestionStages, dataset index sidebar
 * @returns Sorted dataset tags.
 */
export function detectDatasets(text: string): string[] {
  if (!text) return [];
  const matched = new Set<string>();
  for (const { tag, pattern } of DATASETS) {
    if (pattern.test(text)) matched.add(tag);
  }
  return Array.from(matched).sort();
}
