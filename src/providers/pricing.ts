import type { ModelUsage } from '../types/domain.js';

export interface PriceSnapshot {
  id: string;
  capturedAt: string;
  inputMicroPerMTok: number;
  outputMicroPerMTok: number;
  source: string;
}

export function reservationMicro(system: string, user: string, maxOutputTokens: number, price: PriceSnapshot): number {
  const inputBytes = Buffer.byteLength(system + user, 'utf8');
  return Math.ceil((inputBytes * price.inputMicroPerMTok + maxOutputTokens * price.outputMicroPerMTok) / 1_000_000);
}

export function actualMicro(usage: ModelUsage, price: PriceSnapshot): number {
  return Math.ceil((usage.inputTokens * price.inputMicroPerMTok + usage.outputTokens * price.outputMicroPerMTok) / 1_000_000);
}
