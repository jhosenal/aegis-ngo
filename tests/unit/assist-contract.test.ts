import { describe, expect, it } from 'vitest';
import { selectPublicCards, validateCard, type Card } from '../../src/assist/contract.js';

type Src = Card['sources'][number];
const source = (over: Record<string, unknown> = {}): Src => ({
  sourceId: 'SRC-1', publisher: 'Synthetic test publisher', url: 'https://example.org/guidance', accessed: '2026-10-14',
  status: 'SOURCED', passage: 'Synthetic test passage.', ...over,
}) as Src;
const flood = (over: Partial<Card> = {}): Card => ({
  id: 'CARD-FLOOD-1', language: 'en', country: 'MY', hazard: 'flood', audience: 'general', severity: 'high', title: 'Synthetic flash flood', synthetic: true,
  lines: [
    { id: 'L1', kind: 'contact', text: 'Call the emergency number.', sourceId: 'SRC-1' },
    { id: 'L2', kind: 'dont', text: 'Do not walk through moving water.', sourceId: 'SRC-1' },
  ],
  sources: [source()],
  ...over,
});
const cardiac = (status: string): Card => flood({ id: 'CARD-CARDIAC-1', hazard: 'cardiac', sources: [source({ status })] });

describe('assist content contract', () => {
  it('accepts a well-formed sourced card', () => {
    expect(validateCard(flood())).toEqual([]);
    expect(selectPublicCards([flood()], { draftMedical: false })).toEqual([{ card: flood(), demoBanner: false }]);
  });

  it('rejects a line whose source does not exist in the card', () => {
    const bad = flood({ lines: [flood().lines[0]!, { id: 'L2', kind: 'do', text: 'x', sourceId: 'NOPE' }] });
    expect(validateCard(bad).join()).toMatch(/unknown source NOPE/);
    expect(() => selectPublicCards([bad], { draftMedical: false })).toThrow(/unknown source/);
  });

  it('rejects a SOURCED source with no quoted passage', () => {
    expect(validateCard(flood({ sources: [source({ passage: '  ' })] })).join()).toMatch(/must quote its passage/);
  });

  it('requires the emergency contact line to come first', () => {
    const bad = flood({ lines: [flood().lines[1]!, flood().lines[0]!] });
    expect(validateCard(bad).join()).toMatch(/first line must be the emergency contact/);
  });

  it('rejects duplicate ids, non-https sources and unknown keys', () => {
    expect(validateCard(flood({ sources: [source(), source()] })).join()).toMatch(/duplicate source/);
    expect(validateCard(flood({ lines: [flood().lines[0]!, { ...flood().lines[0]! }] })).join()).toMatch(/duplicate line/);
    expect(validateCard(flood({ sources: [source({ url: 'http://example.org/x' })] })).length).toBeGreaterThan(0);
    expect(validateCard({ ...flood(), extra: 1 }).length).toBeGreaterThan(0);
  });

  it('never shows content that still waits for a source', () => {
    const pending = flood({ sources: [source({ status: 'PENDING_SOURCE', passage: '' })] });
    expect(selectPublicCards([pending], { draftMedical: true })).toEqual([]);
    expect(selectPublicCards([pending], { draftMedical: false })).toEqual([]);
  });

  it('shows draft medical content only with the server flag, and always with the demo banner', () => {
    expect(selectPublicCards([cardiac('DRAFT_UNREVIEWED')], { draftMedical: false })).toEqual([]);
    const on = selectPublicCards([cardiac('DRAFT_UNREVIEWED')], { draftMedical: true });
    expect(on).toHaveLength(1);
    expect(on[0]!.demoBanner).toBe(true);
  });

  it('never shows draft content for a non-medical hazard, even with the flag on', () => {
    const draftFlood = flood({ sources: [source({ status: 'DRAFT_UNREVIEWED' })] });
    expect(selectPublicCards([draftFlood], { draftMedical: true })).toEqual([]);
  });

  it('treats a card without a country as Malaysia and accepts only MY, SG and ID', () => {
    const { country: _ignored, ...withoutCountry } = flood();
    expect(selectPublicCards([withoutCountry], { draftMedical: false })[0]!.card.country).toBe('MY');
    expect(validateCard({ ...flood(), country: 'SG' })).toEqual([]);
    expect(validateCard({ ...flood(), country: 'XX' }).length).toBeGreaterThan(0);
  });

  it('accepts the haze hazard and treats it like any other sourced non-medical hazard', () => {
    const haze = flood({ id: 'CARD-HAZE-1', hazard: 'haze', country: 'SG' });
    expect(selectPublicCards([haze], { draftMedical: false })).toHaveLength(1);
    const draftHaze = flood({ id: 'CARD-HAZE-2', hazard: 'haze', sources: [source({ status: 'DRAFT_UNREVIEWED' })] });
    expect(selectPublicCards([draftHaze], { draftMedical: true })).toEqual([]);
  });

  it('fails loudly when any card in the file is invalid, so a bad file cannot hide behind good cards', () => {
    expect(() => selectPublicCards([flood(), { id: 'BAD' }], { draftMedical: false })).toThrow(/invalid assist card/);
  });
});

describe('synthetic fixture used by the UI workers', () => {
  it('passes the contract and is shown as public content', async () => {
    const { readFileSync } = await import('node:fs');
    const cards = JSON.parse(readFileSync(new URL('../fixtures/assist/synthetic-flood.json', import.meta.url), 'utf8')) as unknown[];
    expect(cards.every((c) => validateCard(c).length === 0)).toBe(true);
    expect(selectPublicCards(cards, { draftMedical: false })).toHaveLength(cards.length);
    expect(JSON.stringify(cards)).not.toMatch(/https?:\/\/(?!example\.org)/);
  });
});
