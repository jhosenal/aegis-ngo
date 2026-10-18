import { describe, expect, it } from 'vitest';
import { createGoogleTranslator, translatorFromEnv } from '../../src/services/translateGoogle.js';
import { translateBulletin } from '../../src/services/broadcast/translation.js';
import { buildEmergencyBulletin } from '../../src/services/broadcast/emergency.js';
import { loadSchedule } from '../../src/services/broadcast/schedule.js';

const quake = { evidenceId: 'EV-Q1', incidentKey: 'q', hazardType: 'EARTHQUAKE', alertLevel: 'ORANGE', title: 'M 6.1 - 20 km NE of Kota Kinabalu, Malaysia', eventTime: '2026-10-17T01:30:00Z', lat: 6.1, lon: 116.2, sourceId: 'SRC.USGS.LIVE' };

describe('Google Cloud Translation fast path', () => {
  it('sends the texts in one request with the key in a header and returns them in order', async () => {
    const seen: { url: string; key: string | undefined; body: { q: string[]; target: string; source: string; format: string } }[] = [];
    const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => { seen.push({ url, key: init.headers['X-Goog-Api-Key'], body: JSON.parse(init.body) }); return new Response(JSON.stringify({ data: { translations: (JSON.parse(init.body) as { q: string[] }).q.map((t) => ({ translatedText: `[ms] ${t}` })) } }), { status: 200 }); }) as unknown as typeof fetch;
    const t = createGoogleTranslator({ apiKey: 'k', fetchImpl });
    expect(await t.translate(['a 1', 'b 2'], 'ms')).toEqual(['[ms] a 1', '[ms] b 2']);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ key: 'k', body: { target: 'ms', source: 'en', format: 'text' } });
    expect(seen[0]!.url).not.toContain('key=');   // the key never goes in the URL
  });
  it('fails clearly on an error answer and an incomplete answer, and is off unless switched on', async () => {
    const bad = createGoogleTranslator({ apiKey: 'k', fetchImpl: (async () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 })) as unknown as typeof fetch });
    await expect(bad.translate(['x'], 'ta')).rejects.toThrow(/PERMISSION_DENIED/);
    const short = createGoogleTranslator({ apiKey: 'k', fetchImpl: (async () => new Response(JSON.stringify({ data: { translations: [] } }), { status: 200 })) as unknown as typeof fetch });
    await expect(short.translate(['x'], 'ta')).rejects.toThrow(/incomplete/);
    expect(translatorFromEnv({})).toBeNull();
    expect(translatorFromEnv({ AEGIS_TRANSLATE_ENABLED: 'true', AEGIS_GOOGLE_TTS_API_KEY: 'k' })).not.toBeNull();
  });
  it('translateBulletin works with Google alone: forward and back by Google, numbers checked, labelled as Google', async () => {
    const machine = { name: 'google-cloud-translation', translate: async (texts: string[], target: string) => texts.map((t) => (target === 'en' ? t.replace(/^<ms> /, '') : `<ms> ${t}`)) };
    const { bulletin } = buildEmergencyBulletin({ schedule: loadSchedule(), incident: quake, now: '2026-10-17T03:00:00Z', bulletinId: 'B1' });
    const r = await translateBulletin({ machine, bulletin, language: 'ms', tenantId: 't', taskId: 'x', models: { translate: 'm1', back: 'm2' } });
    expect(r.models).toEqual({ translate: 'google-cloud-translation', back: 'google-cloud-translation' });
    expect(r.problems).toEqual([]);
    expect(r.texts[0]).toMatch(/^<ms> /);
    await expect(translateBulletin({ bulletin, language: 'ms', tenantId: 't', taskId: 'x', models: { translate: 'a', back: 'b' } })).rejects.toThrow(/No translator/);
  });
});

import { backNumberParity } from '../../src/services/broadcast/translation.js';
describe('back-translation number check', () => {
  it('accepts a number spelled out in the English back-translation, but not a number that is really missing', () => {
    expect(backNumberParity('9 monitored locations in Johor', 'nine surveillance locations in Johor')).toEqual([]);
    expect(backNumberParity('9 monitored locations in Johor', 'several locations in Johor')).toEqual(['the number 9 is missing']);
    expect(backNumberParity('PSI 193 and 161', 'PSI 193 and one hundred sixty')).toEqual(['the number 161 is missing']);
  });
});
