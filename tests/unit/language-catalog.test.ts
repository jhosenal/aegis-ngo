import { describe, expect, it } from 'vitest';
import { loadLanguageCatalog, normalizeLanguages } from '../../src/services/broadcast/languages.js';

describe('bulletin language catalog (AEG-NEWS-007)', () => {
  const catalog = loadLanguageCatalog();
  it('has the four pilot languages and the other major ASEAN languages; only English is active', () => {
    const codes = catalog.languages.map((l) => l.code);
    expect(codes).toEqual(['en', 'ms', 'zh', 'ta', 'id', 'th', 'vi', 'tl', 'my', 'km', 'lo']);
    expect(catalog.languages.filter((l) => l.group === 'pilot').map((l) => l.code)).toEqual(['en', 'ms', 'zh', 'ta']);
    expect(catalog.languages.filter((l) => l.state === 'active').map((l) => l.code)).toEqual(['en']);
  });
  it('normalises a ticked list: English first and always, no repeats, unknown codes refused', () => {
    expect(normalizeLanguages(catalog, [])).toEqual(['en']);
    expect(normalizeLanguages(catalog, ['th', 'ms', 'th', 'en'])).toEqual(['en', 'th', 'ms']);
    expect(normalizeLanguages(catalog, ['xx'])).toBeNull();
    expect(normalizeLanguages(catalog, 'en')).toBeNull();
    expect(normalizeLanguages(catalog, [1])).toBeNull();
  });
});
