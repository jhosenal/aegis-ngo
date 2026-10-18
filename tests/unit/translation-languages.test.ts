import { describe, expect, it } from 'vitest';
import { TRANSLATION_LANGUAGES } from '../../src/services/broadcast/translation.js';

describe('translation languages (Google Cloud Translation and Text-to-Speech)', () => {
  it('keeps the pilot voices and lists the ASEAN languages Google supports', () => {
    expect(TRANSLATION_LANGUAGES['ms']!.speech).toEqual({ languageCode: 'ms-MY', voice: 'ms-MY-Standard-A' });
    expect(TRANSLATION_LANGUAGES['zh']).toMatchObject({ code: 'zh-CN', speech: { voice: 'cmn-CN-Standard-A' } });
    expect(TRANSLATION_LANGUAGES['ta']!.speech!.voice).toBe('ta-IN-Standard-A');
    expect(Object.keys(TRANSLATION_LANGUAGES).sort()).toEqual(['ceb', 'hmn', 'id', 'ilo', 'jv', 'km', 'lo', 'ms', 'my', 'pt', 'shn', 'su', 'ta', 'tet', 'th', 'tl', 'vi', 'zh']);
  });
  it('a language without a Google voice has no speech entry, so the voice route refuses it', () => {
    for (const code of ['km', 'hmn', 'jv', 'su', 'lo', 'my', 'shn', 'ceb', 'ilo', 'tet']) expect(TRANSLATION_LANGUAGES[code]!.speech).toBeUndefined();
    for (const code of ['ms', 'zh', 'ta', 'vi', 'id', 'tl', 'th', 'pt']) expect(TRANSLATION_LANGUAGES[code]!.speech).toBeDefined();
  });
});
