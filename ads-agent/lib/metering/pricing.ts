// Small, explicit per-model $/1K-token map for the only three Vertex models this app routes to
// (see docs/superpowers/specs/2026-08-04-token-credit-accounting-design.md — Bifrost's synchronous
// response doesn't reliably carry a cost field, so cost is computed here from raw token counts).
// Verify against https://cloud.google.com/vertex-ai/generative-ai/pricing before go-live; rates
// change.
export type ModelPricing = { inputPer1k: number; outputPer1k: number };

export const CREDITS_PER_USD = 100; // 1 credit = $0.01

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash-lite": { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  "gemini-2.5-flash": { inputPer1k: 0.0003, outputPer1k: 0.0025 },
  "gemini-2.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.01 },
};

function normalizeModelName(model: string): string {
  return model.includes("/") ? model.split("/").pop()! : model;
}

/**
 * ponytail: unknown model returns 0 rather than throwing, so an unlisted/new model never blocks a
 * real request. Ceiling: spend from an unlisted model is invisible in the ledger. Upgrade path: add
 * the model to MODEL_PRICING above.
 */
export function computeCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[normalizeModelName(model)];
  if (!pricing) return 0;
  return (promptTokens / 1000) * pricing.inputPer1k + (completionTokens / 1000) * pricing.outputPer1k;
}

export function creditsFromCostUsd(costUsd: number): number {
  return costUsd * CREDITS_PER_USD;
}

export function usdFromCredits(credits: number): number {
  return credits / CREDITS_PER_USD;
}
