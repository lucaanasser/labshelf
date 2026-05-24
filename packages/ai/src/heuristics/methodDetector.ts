/**
 * F11 — Methodology auto-tagging. Scans a paper's text for canonical ML/CS
 * methodology keywords using a curated lexicon. Each method has aliases so
 * variations like "contrastive learning" / "contrastive pre-training" map to
 * a single tag.
 *
 * @depends none
 * @dependents pipeline/ingestionStages.ts
 */

interface MethodEntry {
  tag: string;
  patterns: RegExp[];
}

const LEXICON: MethodEntry[] = [
  { tag: "contrastive", patterns: [/\bcontrastive\b/i, /\bSimCLR\b/, /\bMoCo\b/, /\bSupCon\b/] },
  { tag: "supervised", patterns: [/\bsupervised (?:fine-?tuning|learning)\b/i, /\bSFT\b/] },
  { tag: "self-supervised", patterns: [/\bself-?supervised\b/i, /\bSSL\b/] },
  { tag: "reinforcement-learning", patterns: [/\breinforcement learning\b/i, /\bRLHF\b/, /\bPPO\b/, /\bDPO\b/] },
  { tag: "distillation", patterns: [/\b(?:knowledge )?distillation\b/i, /\bteacher-student\b/i] },
  { tag: "masked-language-modeling", patterns: [/\bmasked language modell?ing\b/i, /\bMLM\b/] },
  { tag: "causal-language-modeling", patterns: [/\bcausal language modell?ing\b/i, /\bnext-token prediction\b/i] },
  { tag: "fine-tuning", patterns: [/\bfine-?tun(?:e|ing)\b/i] },
  { tag: "pre-training", patterns: [/\bpre-?train(?:ing)?\b/i] },
  { tag: "in-context-learning", patterns: [/\bin-?context learning\b/i, /\bICL\b/, /\bfew-shot\b/i] },
  { tag: "diffusion", patterns: [/\bdiffusion (?:model|process)\b/i, /\bDDPM\b/, /\bscore-based\b/i] },
  { tag: "retrieval-augmented", patterns: [/\bRAG\b/, /\bretrieval-augmented\b/i] },
  { tag: "mixture-of-experts", patterns: [/\bmixture of experts\b/i, /\bMoE\b/] },
  { tag: "attention", patterns: [/\bself-?attention\b/i, /\bmulti-?head attention\b/i] },
  { tag: "transformer", patterns: [/\btransformer\b/i] },
  { tag: "graph-neural-network", patterns: [/\bgraph neural network\b/i, /\bGNN\b/] },
  { tag: "variational", patterns: [/\bvariational autoencoder\b/i, /\bVAE\b/] },
  { tag: "gan", patterns: [/\bgenerative adversarial\b/i, /\bGAN\b/] },
];

/**
 * Returns the methodology tags detected in the paper's text.
 *
 * @usedBy ingestionStages, vscode list panel chips
 * @returns Distinct, alphabetically sorted method tags.
 */
export function detectMethods(text: string): string[] {
  if (!text) return [];
  const matched = new Set<string>();
  for (const entry of LEXICON) {
    if (entry.patterns.some((re) => re.test(text))) matched.add(entry.tag);
  }
  return Array.from(matched).sort();
}
