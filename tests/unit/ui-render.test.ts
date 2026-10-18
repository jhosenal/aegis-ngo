import { describe, expect, it } from 'vitest';
import { fieldDisplayValue, flagExplanation, noticeText, statusLabel } from '../../ui/src/format.js';

describe('TSK-014 pure UI formatting', () => {
  it('AEG-TST-014 displays null as Unknown and preserves zero', () => {
    expect(fieldDisplayValue(null)).toBe('Unknown');
    expect(fieldDisplayValue(0)).toBe('0');
  });

  it('AEG-TST-014 labels every card state with a symbol', () => {
    for (const state of ['draft', 'validated', 'reviewed', 'superseded', 'awaiting-input'] as const) {
      expect(statusLabel(state)).toMatch(/^[^A-Za-z0-9\s]/);
    }
    expect(statusLabel('draft')).toBe('… Draft');
    expect(statusLabel('validated')).toBe('✓ Validated');
    expect(statusLabel('reviewed')).toBe('✓✓ Reviewed');
    expect(statusLabel('superseded')).toBe('↪ Superseded');
    expect(statusLabel('awaiting-input')).toBe('⚠ Awaiting input');
  });

  it('AEG-TST-014 gives exact provider notice text for every code', () => {
    expect(noticeText('GOOGLE_UNAVAILABLE_BACKUP_USED')).toBe('Primary model unavailable; a backup model answered.');
    expect(noticeText('MODELS_UNAVAILABLE')).toBe('Models are unavailable. Showing the calculated result only.');
    expect(noticeText('MODELS_DISABLED')).toBe('Models are turned off. Use a command such as: help.');
    expect(noticeText('BUDGET_EXHAUSTED')).toBe('Model budget is used up. Showing the calculated result only.');
    expect(noticeText('REFUSED')).toBe('The model declined this request.');
  });

  it('AEG-TST-014 gives unknown evidence flags a safe generic label', () => {
    expect(flagExplanation('UNRECOGNIZED')).toBe('Evidence flag: UNRECOGNIZED');
  });
});
