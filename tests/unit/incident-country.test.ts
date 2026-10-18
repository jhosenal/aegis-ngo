import { describe, expect, it } from 'vitest';
import { withCountry } from '../../src/services/incidentCountry.js';
import type { CardRevision } from '../../src/types/domain.js';

const card = (kind: string, region: string | null, extra: unknown[] = []): CardRevision => ({
  cardId: 'C1', tenantId: 'T', kind, revision: 1, state: 'DRAFT', title: 't', evidenceIds: [],
  body: { synthetic: false, fields: [{ key: 'regionId', label: 'Region', value: region, unit: null, epistemic: 'fact' }, ...extra] },
}) as unknown as CardRevision;

describe('derived country field on existing card revisions', () => {
  it('adds the ASEAN country at read time without touching the stored card', () => {
    const stored = card('incident', 'REGION.PHILIPPINES');
    const out = withCountry(stored);
    expect(out.body.fields.find((f) => f.key === 'country')).toMatchObject({ value: 'Philippines', epistemic: 'calculation' });
    expect(stored.body.fields.some((f) => f.key === 'country')).toBe(false);
  });
  it('a sea region gives an explicit unknown, never a guess; non-incident or already-set cards are unchanged', () => {
    expect(withCountry(card('incident', 'REGION.SOUTH_CHINA_SEA')).body.fields.find((f) => f.key === 'country')).toMatchObject({ value: null, epistemic: 'unknown' });
    const resource = card('resource', 'REGION.PHILIPPINES');
    expect(withCountry(resource)).toBe(resource);
    const has = card('incident', 'REGION.PHILIPPINES', [{ key: 'country', label: 'x', value: 'Y', unit: null, epistemic: 'fact' }]);
    expect(withCountry(has)).toBe(has);
    const noRegion = card('incident', null);
    expect(withCountry(noRegion).body.fields.find((f) => f.key === 'country')).toMatchObject({ value: null });
  });
});
