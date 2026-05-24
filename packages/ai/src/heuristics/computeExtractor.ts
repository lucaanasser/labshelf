/**
 * F16 — Compute disclosure extraction. Detects accelerator counts/models and
 * training hours; estimates cost from a static cloud-pricing table. The table
 * lives next to the extractor because it is a single source of truth that
 * downstream UI should not duplicate.
 *
 * @depends ../types/metadata.ts
 * @dependents pipeline/ingestionStages.ts
 */
import type { ComputeDisclosure } from "../types/metadata.js";

const COUNT_MODEL = /\b(\d{1,4})\s?[x×]\s?(A100|H100|V100|TPU\s?v\d|MI\d{3}X?)\b/i;
const HOURS = /\b([\d,.]+)\s*(?:GPU|TPU)?-?hours?\b/i;

const HOURLY_USD: Record<string, number> = {
  A100: 2.0,
  H100: 4.0,
  V100: 1.0,
  "TPU v3": 2.0,
  "TPU v4": 4.0,
  MI300X: 3.5,
};

/**
 * Extracts a compute disclosure block from the paper's text.
 *
 * @usedBy ingestionStages, list panel detail card
 * @returns Undefined when no signal is found; otherwise a partial disclosure.
 */
export function extractCompute(text: string): ComputeDisclosure | undefined {
  if (!text) return undefined;
  const countModel = COUNT_MODEL.exec(text);
  const hoursMatch = HOURS.exec(text);
  if (!countModel && !hoursMatch) return undefined;

  const acceleratorCountRaw = countModel?.[1];
  const acceleratorModelRaw = countModel?.[2];
  const hoursRaw = hoursMatch?.[1];

  const acceleratorCount = acceleratorCountRaw ? parseInt(acceleratorCountRaw, 10) : undefined;
  const acceleratorModel = acceleratorModelRaw
    ? normalizeAccelerator(acceleratorModelRaw)
    : undefined;
  const trainingHours = hoursRaw ? parseFloat(hoursRaw.replace(/,/g, "")) : undefined;
  const estimatedCostUsd =
    acceleratorModel && trainingHours
      ? estimateCost(acceleratorModel, trainingHours)
      : undefined;
  const result: ComputeDisclosure = {
    rawSnippet: (countModel?.[0] ?? hoursMatch?.[0] ?? "").trim(),
  };
  if (acceleratorModel !== undefined) result.acceleratorModel = acceleratorModel;
  if (acceleratorCount !== undefined) result.acceleratorCount = acceleratorCount;
  if (trainingHours !== undefined) result.trainingHours = trainingHours;
  if (estimatedCostUsd !== undefined) result.estimatedCostUsd = estimatedCostUsd;
  return result;
}

function normalizeAccelerator(raw: string): string {
  const t = raw.replace(/\s+/g, " ").toUpperCase().trim();
  if (t.startsWith("TPU")) return t.replace("V", "v");
  return t;
}

function estimateCost(model: string, hours: number): number | undefined {
  const rate = HOURLY_USD[model];
  if (!rate) return undefined;
  return Math.round(rate * hours);
}
