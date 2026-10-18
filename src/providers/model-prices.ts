/**
 * Models that may be put in a mode or seat, with a published price. Rule (ENG-008): no model without a published price enters any
 * seat or ladder, because the budget ledger cannot bound spend it cannot price. USD per 1M tokens.
 * reAPI prices come from the QZEEX table of 2026-10-06 (input) and reapi.ai/models; the opus output price is not currently published.
 */
export interface ModelPrice { provider: 'reapi'; inputPerMTokUsd: number; outputPerMTokUsd: number; source: string }

export const PRICED_MODELS: Readonly<Record<string, ModelPrice>> = {
  'gpt-6-luna': { provider: 'reapi', inputPerMTokUsd: 0.08, outputPerMTokUsd: 0.4, source: 'reapi.ai/models and QZEEX table 2026-10-06' },
  'gpt-6-sol': { provider: 'reapi', inputPerMTokUsd: 1.6, outputPerMTokUsd: 8, source: 'reapi.ai/models and QZEEX table 2026-10-06' },
  'claude-opus-5-5': { provider: 'reapi', inputPerMTokUsd: 3.2, outputPerMTokUsd: 16, source: 'QZEEX table 2026-10-06 (reapi.ai/models now shows 2.80 input)' },
  'deepseek-v4.1-flash': { provider: 'reapi', inputPerMTokUsd: 0.4, outputPerMTokUsd: 1.3, source: 'QZEEX table 2026-10-06' },
  'kimi-k3': { provider: 'reapi', inputPerMTokUsd: 3, outputPerMTokUsd: 15, source: 'QZEEX table 2026-10-06 (reapi.ai/models shows 2.50 or 3.00)' },
};

/** Gemini chat models and their CEILING price per 1M tokens (the higher, later price where the page lists a date change), so a reservation can never under-count. Source: records/costs/price-book.json (read 2026-10-17). */
export interface GooglePrice { inputPerMTokUsd: number; outputPerMTokUsd: number; source: string }
export const GOOGLE_PRICED_MODELS: Readonly<Record<string, GooglePrice>> = {
  'gemini-3.5-flash-lite': { inputPerMTokUsd: 0.3, outputPerMTokUsd: 2.5, source: 'ai.google.dev/gemini-api/docs/pricing 2026-10-17' },
  'gemini-3.8-flash': { inputPerMTokUsd: 1.5, outputPerMTokUsd: 7.5, source: 'ai.google.dev/gemini-api/docs/pricing 2026-10-17 (0.75 and 3.75 until 2026-12-31; the later price is used as the ceiling)' },
  'gemini-4-argon': { inputPerMTokUsd: 4, outputPerMTokUsd: 20, source: 'ai.google.dev/gemini-api/docs/pricing 2026-10-17 (2.00 and 10.00 until 2026-11-30; the later price is used as the ceiling)' },
};

export function isPricedModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRICED_MODELS, model);
}
