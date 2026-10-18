// The price book (AEG-CON-004): every price with its source, as data. Loading validates it, so a price without a quoted source or an
// invalid number cannot enter. A missing price is UNKNOWN to the formulas, never zero.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hashWithDomain } from '../engine/canonical.js';
import { div, parseDecimal, type Rat, usdToNano, MoneyError } from './money.js';

const decimal = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/);
const SourceSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), 'source URLs must be https'),
  accessed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  passage: z.string().min(1).max(1200),
  note: z.string().max(900).optional(),
  /** A saved copy of the source page (repository path) and strings that must appear in it: a test re-checks them mechanically. */
  check: z.object({ file: z.string().min(1), contains: z.array(z.string().min(1)).min(1) }).strict().optional(),
}).strict();

export const PriceSchema = z.object({
  priceId: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{2,80}$/),
  service: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
  unit: z.string().min(1).max(60),
  per: decimal,
  priceUsd: decimal,
  tier: z.enum(['TIER_1', 'TIER_2']).nullable(),
  status: z.enum(['QUOTED', 'SECONDARY']),
  /** For model prices: the model name exactly as the publisher writes it, and which tokens the price is for. */
  model: z.string().min(1).max(80).optional(),
  direction: z.enum(['input', 'output']).optional(),
  /** Prices that change on a date: the first and the last day (YYYY-MM-DD) the price applies. */
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: SourceSchema,
}).strict();

export const FreeTierSchema = z.object({
  freeId: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{2,80}$/),
  service: z.string().min(1).max(60),
  unit: z.string().min(1).max(60),
  quantityPerMonth: decimal,
  scope: z.enum(['billing-account', 'project']),
  priceId: z.string(),
  source: SourceSchema,
}).strict();

export const PriceBookSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string(),
  version: z.string(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.literal('USD'),
  rules: z.string(),
  prices: z.array(PriceSchema).min(1),
  freeTiers: z.array(FreeTierSchema),
  runFreeTierRule: z.object({ text: z.string(), source: SourceSchema }).strict(),
  regionTiers: z.record(z.string(), z.object({ TIER_1: z.array(z.string()), TIER_2: z.array(z.string()), source: SourceSchema }).strict()),
}).strict();

export type Price = z.infer<typeof PriceSchema>;
export type FreeTier = z.infer<typeof FreeTierSchema>;
export type PriceBook = z.infer<typeof PriceBookSchema> & { hash: string };

export const DEFAULT_PRICE_BOOK = fileURLToPath(new URL('../../records/costs/price-book.json', import.meta.url));

export function parsePriceBook(raw: unknown): PriceBook {
  const book = PriceBookSchema.parse(raw);
  const ids = new Set<string>();
  for (const p of book.prices) {
    if (ids.has(p.priceId)) throw new MoneyError('DUPLICATE_PRICE', `duplicate priceId ${p.priceId}`);
    ids.add(p.priceId);
  }
  for (const f of book.freeTiers) if (!ids.has(f.priceId)) throw new MoneyError('FREE_TIER_PRICE_MISSING', `free tier ${f.freeId} names unknown price ${f.priceId}`);
  const tierRegions = new Set<string>();
  for (const [service, t] of Object.entries(book.regionTiers)) {
    for (const r of [...t.TIER_1, ...t.TIER_2]) {
      const key = `${service}/${r}`;
      if (tierRegions.has(key)) throw new MoneyError('REGION_IN_TWO_TIERS', `${key} is listed twice`);
      tierRegions.add(key);
    }
  }
  return { ...book, hash: hashWithDomain('AEG-COST-v1', { prices: book.prices, freeTiers: book.freeTiers, runFreeTierRule: book.runFreeTierRule, regionTiers: Object.entries(book.regionTiers).map(([service, t]) => ({ service, tier1: t.TIER_1, tier2: t.TIER_2, source: t.source })), version: book.version }) };
}

export function loadPriceBook(file: string = DEFAULT_PRICE_BOOK): PriceBook {
  return parsePriceBook(JSON.parse(readFileSync(file, 'utf8')));
}

export const findPrice = (book: PriceBook, priceId: string): Price | null => book.prices.find((p) => p.priceId === priceId) ?? null;
export const findFree = (book: PriceBook, freeId: string): FreeTier | null => book.freeTiers.find((f) => f.freeId === freeId) ?? null;

/** Price per base unit in exact nano-USD, or null when the price is not in the book. */
export function unitNano(book: PriceBook, priceId: string): Rat | null {
  const p = findPrice(book, priceId);
  if (!p) return null;
  return div(usdToNano(p.priceUsd), parseDecimal(p.per));
}

/** Free quantity per month as an exact rational. */
export function freeQuantity(book: PriceBook, freeId: string): Rat | null {
  const f = findFree(book, freeId);
  return f ? parseDecimal(f.quantityPerMonth) : null;
}

/** Which pricing tier a Cloud Run region is in, or null when the region was not read from the source. */
export function runTier(book: PriceBook, region: string): 'TIER_1' | 'TIER_2' | null {
  const t = book.regionTiers['cloud-run'];
  if (!t) return null;
  if (t.TIER_1.includes(region)) return 'TIER_1';
  if (t.TIER_2.includes(region)) return 'TIER_2';
  return null;
}

