import { describe, expect, it } from 'vitest';
import { LEXICON, resolveTerm } from '../../src/registry/lexicon.js';

describe('lexicon', () => {
  it('resolveTerm exact, alias and ambiguous', () => {
    const exact = resolveTerm(' AEG.T.DEMAND_UNITS ');
    expect(exact.kind).toBe('exact');
    if (exact.kind === 'exact') expect(exact.entry.termId).toBe('AEG.T.DEMAND_UNITS');

    const alias = resolveTerm(' NeEd ');
    expect(alias.kind).toBe('exact');
    if (alias.kind === 'exact') expect(alias.entry.termId).toBe('AEG.T.DEMAND_UNITS');

    const ambiguous = resolveTerm('stock');
    expect(ambiguous.kind).toBe('ambiguous');
    if (ambiguous.kind === 'ambiguous') {
      expect(ambiguous.candidates).toHaveLength(2);
      expect(ambiguous.candidates.map((entry) => entry.termId)).toEqual([
        'AEG.T.AVAILABLE_UNITS', 'AEG.T.RESERVE_UNITS',
      ]);
    }
    expect(resolveTerm('zzz')).toEqual({ kind: 'none' });
    expect(resolveTerm('  dEmAnD uNiTs  ').kind).toBe('exact');
  });

  it('every lexicon entry is complete', () => {
    const expectedIds = [
      'AEG.T.DEMAND_UNITS', 'AEG.T.AVAILABLE_UNITS', 'AEG.T.RESERVE_UNITS',
      'AEG.T.USABLE_UNITS', 'AEG.T.SHORTFALL_UNITS', 'AEG.T.SURPLUS_UNITS',
      'AEG.T.INCIDENT', 'AEG.T.EVIDENCE', 'AEG.T.AS_OF',
    ];
    expect(LEXICON.map((entry) => entry.termId)).toEqual(expectedIds);
    expect(new Set(LEXICON.map((entry) => entry.termId)).size).toBe(LEXICON.length);

    for (const entry of LEXICON) {
      expect(entry.namespace).toBe('AEG.T');
      expect(entry.projectDefined).toBe(true);
      expect(entry.lifecycle).toBe('active');
      expect(entry.version).toBe('1.0.0');
      expect(entry.owner).toBe('Owner');
      expect(entry.provenance).toBe('AEG-CON-001');
      for (const value of [entry.termId, entry.preferredLabel, entry.definition, entry.typeOrUnit, entry.domain, entry.version, entry.owner, entry.provenance]) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
      expect(entry.aliases.every((alias) => alias.trim().length > 0)).toBe(true);
    }

    const matches = new Map<string, string[]>();
    for (const entry of LEXICON) {
      for (const label of [entry.preferredLabel, entry.termId, ...entry.aliases]) {
        const normalized = label.trim().toLocaleLowerCase('en-US');
        matches.set(normalized, [...(matches.get(normalized) ?? []), entry.termId]);
      }
    }
    const collisions = [...matches.entries()].filter(([, ids]) => new Set(ids).size > 1);
    expect(collisions).toEqual([['stock', ['AEG.T.AVAILABLE_UNITS', 'AEG.T.RESERVE_UNITS']]]);
  });
});
