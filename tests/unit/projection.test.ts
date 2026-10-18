import { describe, expect, it } from 'vitest';
import { AegisError } from '../../src/engine/errors.js';
import type { CardField, CardRevision, EvidenceView, QualityFlag } from '../../src/types/domain.js';
import { fieldText } from '../../ui/src/format.js';
import { describeModel, labelOf, MAX_LABEL_CHARS, MAX_TILES, projectCards, type ProjectionInput } from '../../ui/src/scene/projection.js';

function card(cardId: string, kind: CardRevision['kind'], title: string, fields: CardField[] = []): CardRevision {
  return {
    cardId, tenantId: 'TENANT-A', kind, revision: 1, state: 'validated', title,
    body: {
      kind, status: 'ok', synthetic: true, syntheticLabel: 'SYNTHETIC', summary: title, fields, sections: [],
      assumptions: [], warnings: [], missing: [], result: null,
    },
    evidenceIds: [], formulationRef: null, workflowRunId: null, createdAt: '2026-10-13T00:00:00Z', createdBy: 'USER-A',
  };
}
const shortfall = (value: unknown): CardField => ({ key: 'shortfallUnits', label: 'Shortfall', value: value as number | null, unit: 'UNIT.WATER_KIT', epistemic: 'calculation' });
const evidence = (flags: QualityFlag[]): EvidenceView => ({ flags, ageSeconds: 0 } as unknown as EvidenceView);
const item = (cardRevision: CardRevision, flags: QualityFlag[] = []): ProjectionInput => ({ card: cardRevision, evidence: flags.length ? [evidence(flags)] : [] });

function code(action: () => unknown): string | null {
  try { action(); return null; } catch (error: unknown) { return error instanceof AegisError ? error.code : 'OTHER'; }
}

describe('TSK-022 morphism projection', () => {
  it('AEG-UXD-001 projects incidents and assessments to typed tiles, sorted by card id', () => {
    const model = projectCards([
      item(card('ASM-2', 'assessment', 'Assessment two', [shortfall(40)])),
      item(card('INC-1', 'incident', 'Flood event'), ['CONFLICTING', 'STALE']),
    ]);
    expect(model.tiles.map((tile) => tile.cardId)).toEqual(['ASM-2', 'INC-1']);
    expect(model.tiles[0]?.quantity).toEqual({ kind: 'units', units: 40, text: '40 UNIT.WATER_KIT' });
    expect(model.tiles[1]).toMatchObject({ kind: 'incident', quantity: { kind: 'none' }, flags: ['CONFLICTING', 'STALE'] });
    expect(model.ambient).toBe('attention');
  });

  it('AEG-UXD-001 a null quantity stays Unknown and is never drawn as zero', () => {
    const model = projectCards([item(card('ASM-1', 'assessment', 'Waiting', [shortfall(null)]))]);
    expect(model.tiles[0]?.quantity).toEqual({ kind: 'unknown', text: 'Unknown' });
    const zero = projectCards([item(card('ASM-0', 'assessment', 'No gap', [shortfall(0)]))]);
    expect(zero.tiles[0]?.quantity).toEqual({ kind: 'units', units: 0, text: '0 UNIT.WATER_KIT' });
  });

  it('AEG-UXD-001 refuses input it cannot represent instead of clamping it', () => {
    expect(code(() => projectCards([item(card('ASM-1', 'assessment', 'Bad', [shortfall(-5)]))]))).toBe('E_VALIDATION');
    expect(code(() => projectCards([item(card('ASM-1', 'assessment', 'Bad', [shortfall(2.5)]))]))).toBe('E_VALIDATION');
    expect(code(() => projectCards([item(card('ASM-1', 'assessment', 'Bad', [shortfall('40')]))]))).toBe('E_VALIDATION');
    expect(code(() => projectCards([item(card('ASM-1', 'assessment', 'No field'))]))).toBe('E_VALIDATION');
    expect(code(() => projectCards([item(card('', 'incident', 'No id'))]))).toBe('E_VALIDATION');
    expect(code(() => projectCards([item(card('X-1', 'spaceship' as CardRevision['kind'], 'Unknown kind'))]))).toBe('E_VALIDATION');
    expect(code(() => projectCards([item(card('INC-1', 'incident', 'A')), item(card('INC-1', 'incident', 'B'))]))).toBe('E_VALIDATION');
  });

  it('AEG-UXD-001 valid kinds without a tile are skipped, and the model is deterministic', () => {
    const input = [item(card('NOTE-1', 'note', 'A note')), item(card('INC-2', 'incident', 'Two')), item(card('INC-1', 'incident', 'One'))];
    const first = projectCards(input);
    expect(first.tiles.map((tile) => tile.cardId)).toEqual(['INC-1', 'INC-2']);
    expect(projectCards([...input].reverse())).toEqual(first);
    expect(first.ambient).toBe('calm');
  });

  it('AEG-UXD-001 caps the number of tiles and says so', () => {
    const many = Array.from({ length: MAX_TILES + 5 }, (_, index) => item(card(`INC-${String(index).padStart(4, '0')}`, 'incident', `Event ${index}`)));
    const model = projectCards(many);
    expect(model.tiles).toHaveLength(MAX_TILES);
    expect(model.truncated).toBe(true);
  });

  it('AEG-UXD-001 labels are short plain data: markup is kept as text and control characters are removed', () => {
    const long = 'A'.repeat(100);
    expect(Array.from(labelOf(long))).toHaveLength(MAX_LABEL_CHARS);
    expect(labelOf(long).endsWith('…')).toBe(true);
    expect(labelOf('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
    expect(labelOf('line\u0000one\n\ntwo')).toBe('line one two');
    expect(labelOf('Short title')).toBe('Short title');
  });

  it('AEG-UXD-001 the 3D text and the 2D card say the same thing (the projection commutes)', () => {
    const cards = [
      card('ASM-1', 'assessment', 'Water kit assessment for the flood', [shortfall(40)]),
      card('ASM-2', 'assessment', 'Waiting for inputs', [shortfall(null)]),
      card('INC-1', 'incident', 'Synthetic flood event, Demo Region A'),
    ];
    const lines = describeModel(projectCards(cards.map((entry) => item(entry, entry.cardId === 'INC-1' ? ['CONFLICTING'] : []))));
    for (const entry of cards) {
      const line = lines.find((text) => text.startsWith(`${entry.cardId} |`));
      expect(line).toBeDefined();
      expect(line).toContain(entry.title);                                   // titles here are under the label limit
      const field = entry.body.fields.find((candidate) => candidate.key === 'shortfallUnits');
      if (field) expect(line).toContain(fieldText(field));                   // exactly the text the card prints
    }
    expect(lines.find((text) => text.startsWith('INC-1'))).toContain('CONFLICTING');
    expect(lines.find((text) => text.startsWith('INC-1'))).toContain('no quantity');
  });
});
