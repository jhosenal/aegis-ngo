import { describe, expect, it } from 'vitest';
import { createVertexClient, vertexFromEnv, type VertexClient } from '../../src/services/vertexGemini.js';
import { reviewSegment } from '../../src/services/broadcast/scriptReview.js';
import { estimateJob } from '../../src/services/jobs.js';
import type { Bulletin } from '../../src/services/broadcast/script.js';

const seg = (id: string, title: string, text: string) => ({ id, title, text, focus: null, evidenceIds: [], sourceIds: [], lowerThird: 'Source: NEA', startSec: 0, durationSec: 5 });
const bulletin = { bulletinId: 'B1', slotId: 'emergency', language: 'en', captureAt: '2026-10-17T06:00:00Z', airAt: '2026-10-17T06:00:00Z', generatedAt: '2026-10-17T06:00:00Z', scheduleVersion: '1', factSheetHash: 'h', lowerThird: '', estimatedSeconds: 20,
  segments: [seg('country-sgp', 'Singapore', 'First, Singapore. NEA reports the 24-hour PSI ranged from 129 in the north to 196 in the west. All 5 regions are in the Unhealthy band.'), seg('emergency-actions', 'What to do', 'In Singapore: Reduce outdoor activity.')] } as unknown as Bulletin;
const fake = (text: string): VertexClient => ({ model: 'gemini-4-argon', project: 'p', location: 'global', generate: async () => ({ text, usage: { promptTokens: 300, outputTokens: 60, thoughtsTokens: 140, totalTokens: 500 }, model: 'gemini-4-argon', modelVersion: 'v', latencyMs: 900, finishReason: 'STOP' }) });

describe('Vertex AI client', () => {
  it('posts one generateContent call with a bearer token, no API key, and returns real token counts; thinking parts are not text', async () => {
    const seen: { url: string; headers: Record<string, string>; body: { generationConfig: { maxOutputTokens: number } } }[] = [];
    const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => { seen.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hidden thought', thought: true }, { text: 'Rewritten.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 20, thoughtsTokenCount: 80, totalTokenCount: 220 }, modelVersion: 'gemini-4-argon' }), { status: 200 }); }) as unknown as typeof fetch;
    const c = createVertexClient({ project: 'proj', fetchImpl, token: async () => 'tok' });
    const r = await c.generate('sys', 'user', { maxOutputTokens: 500 });
    expect(r.text).toBe('Rewritten.');
    expect(r.usage).toEqual({ promptTokens: 120, outputTokens: 20, thoughtsTokens: 80, totalTokens: 220 });
    expect(seen[0]!.url).toBe('https://aiplatform.googleapis.com/v1/projects/proj/locations/global/publishers/google/models/gemini-4-argon:generateContent');
    expect(seen[0]!.headers['authorization']).toBe('Bearer tok'); expect(JSON.stringify(seen[0]!.headers)).not.toMatch(/api-key/i);
    expect(seen[0]!.body.generationConfig.maxOutputTokens).toBe(500);
  });
  it('fails clearly, refuses unsafe names, and is off without a project', async () => {
    const c = createVertexClient({ project: 'proj', fetchImpl: (async () => new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 })) as unknown as typeof fetch, token: async () => 't' });
    await expect(c.generate('s', 'u')).rejects.toThrow(/HTTP 404 NOT_FOUND/);
    expect(() => createVertexClient({ project: 'x/../y' })).toThrow();
    expect(vertexFromEnv({})).toBeNull();
  });
});

describe('script review proposals are checked like a hand edit', () => {
  it('accepts a rewording that keeps every number and name, and prices the call from the real tokens at Vertex rates', async () => {
    const r = await reviewSegment({ client: fake('First, Singapore. The 24-hour PSI from NEA ranged from 129 in the north to 196 in the west, so all 5 regions are in the Unhealthy band.'), bulletin, segmentId: 'country-sgp' });
    expect(r).toMatchObject({ ok: true, unchanged: false, problems: [] });
    const cost = estimateJob('review', { inputTokens: r.reply!.usage.promptTokens, outputTokens: r.reply!.usage.outputTokens + r.reply!.usage.thoughtsTokens });
    expect(cost.status).toBe('ESTIMATE');
    expect(cost.micro).toBe(Math.ceil(300 * 4 + 200 * 20));        // 300 in at 4 and 200 out at 20 USD per million = 5,200 micro-USD
  });
  it('rejects a proposal that adds a number or a name, changes the length too much, or targets official guidance', async () => {
    expect((await reviewSegment({ client: fake('First, Singapore. NEA reports the 24-hour PSI ranged from 129 in the north to 210 in the west. All 5 regions are in the Unhealthy band.'), bulletin, segmentId: 'country-sgp' })).problems.join(' ')).toMatch(/number 210/);
    expect((await reviewSegment({ client: fake('First, Singapore. NASA reports the 24-hour PSI ranged from 129 in the north to 196 in the west. All 5 regions are in the Unhealthy band.'), bulletin, segmentId: 'country-sgp' })).ok).toBe(false);
    expect((await reviewSegment({ client: fake('Singapore: PSI 129 to 196, Unhealthy.'), bulletin, segmentId: 'country-sgp' })).problems.join(' ')).toMatch(/length changed/);
    const guidance = await reviewSegment({ client: fake('x'), bulletin, segmentId: 'emergency-actions' });
    expect(guidance.ok).toBe(false); expect(guidance.reply).toBeNull();
  });
  it('retries an overlong short-segment draft once and returns the corrected wording with combined usage', async () => {
    const short = { ...bulletin, segments: [seg('emergency-summary', 'Emergency information', 'Strong winds and rough seas affect Malaysia. Listen for warnings and take care.')] } as unknown as Bulletin;
    const rejected = 'Strong winds and rough seas are now affecting Malaysia. Please keep listening for warnings, and do take care.';
    const corrected = 'Strong winds and rough seas affect Malaysia. Keep listening for warnings and take care.';
    expect(rejected.split(/\s+/)).toHaveLength(18);
    expect(corrected.split(/\s+/)).toHaveLength(14);
    const requests: { system: string; user: Record<string, unknown> }[] = [];
    const outputs = [rejected, corrected]; let call = 0;
    const client: VertexClient = { model: 'gemini-4-argon', project: 'p', location: 'global', generate: async (system, user) => {
      requests.push({ system, user: JSON.parse(user) as Record<string, unknown> });
      return { text: outputs[call++]!, usage: { promptTokens: 300, outputTokens: 60, thoughtsTokens: 140, totalTokens: 500 }, model: 'gemini-4-argon', modelVersion: 'v', latencyMs: 900, finishReason: 'STOP' };
    } };
    const r = await reviewSegment({ client, bulletin: short, segmentId: 'emergency-summary' });
    expect(r).toMatchObject({ ok: true, unchanged: false, problems: [] });
    expect(r.proposal).toBe(corrected);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.user.targetWordCount).toBe(13);
    expect(requests[1]!.user.minimumWordCount).toBe(12);
    expect(requests[1]!.user.maximumWordCount).toBe(14);
    expect(r.reply).toMatchObject({ latencyMs: 1800, usage: { promptTokens: 600, outputTokens: 120, thoughtsTokens: 280, totalTokens: 1000 } });
  });
});

import { strengtheningProblems } from '../../src/services/broadcast/scriptReview.js';
describe('hazard likelihood, uncertainty and urgency must not be strengthened by AI rewording', () => {
  const johor = "In Johor, MetMalaysia's forecast for today in Johor Bahru is haze in the morning and at night, thunderstorms in a few places in the afternoon, 24 to 33 degrees.";
  it('rejects the real Argon rewording that said thunderstorms "will hit" a few places', () => {
    const argon = "In Johor, MetMalaysia's forecast for today in Johor Bahru brings morning and night haze. Afternoon thunderstorms will hit a few places, with temperatures from 24 to 33 degrees.";
    const p = strengtheningProblems(johor, argon).join(' ');
    expect(p).toMatch(/"will"/); expect(p).toMatch(/"hit"/);
  });
  it('rejects a dropped qualifier and an added urgency word, and allows a faithful rewording', () => {
    expect(strengtheningProblems('Thunderstorms are possible in some areas.', 'Thunderstorms are expected.').join(' ')).toMatch(/possible|some or a few places/);
    expect(strengtheningProblems('GDACS rates it red.', 'GDACS says it is red.').join(' ')).toMatch(/rated/);
    expect(strengtheningProblems('Heavy rain in a few places.', 'Heavy rain is happening immediately.').join(' ')).toMatch(/"immediately"/);
    expect(strengtheningProblems(johor, "In Johor, MetMalaysia's forecast for today in Johor Bahru is haze in the morning and at night, with thunderstorms in a few places in the afternoon, and 24 to 33 degrees.")).toEqual([]);
    expect(strengtheningProblems('It will rain. Officially confirmed by NEA.', 'NEA officially confirmed it. It will rain.')).toEqual([]);   // words the original already had are not "added"
  });
  it('the review rejects a proposal that strengthens the message even when every number and name is kept', async () => {
    const b = { ...bulletin, segments: [seg('country-mys', 'Malaysia', johor)] } as unknown as Bulletin;
    const r = await reviewSegment({ client: fake("In Johor, MetMalaysia's forecast for today in Johor Bahru brings morning and night haze. Afternoon thunderstorms will hit a few places, with temperatures from 24 to 33 degrees."), bulletin: b, segmentId: 'country-mys' });
    expect(r.ok).toBe(false); expect(r.problems.join(' ')).toMatch(/more certain or urgent/);
  });
});

import { cleanStyleRequest } from '../../src/services/broadcast/scriptReview.js';
describe('the administrator can give the AI a style wish and a working text, inside the same checks', () => {
  const recording = (text: string, seen: { system: string; user: string }[]): VertexClient => ({ model: 'gemini-4-argon', project: 'p', location: 'global', generate: async (system: string, user: string) => { seen.push({ system, user }); return { text, usage: { promptTokens: 300, outputTokens: 60, thoughtsTokens: 140, totalTokens: 500 }, model: 'gemini-4-argon', latencyMs: 1 }; } } as unknown as VertexClient);
  it('cleans the style wish: plain text, no control characters, at most 200 characters', () => {
    expect(cleanStyleRequest('  calmer\u0000\n\tplease  ')).toBe('calmer please');
    expect(cleanStyleRequest(42)).toBe('');
    expect(cleanStyleRequest('x'.repeat(500))).toHaveLength(200);
  });
  it('sends the style wish and the administrator\'s own text to the model, and says in the system prompt that no style wish can override a rule', async () => {
    const seen: { system: string; user: string }[] = [];
    await reviewSegment({ client: recording('First, Singapore. NEA reports the 24-hour PSI ranged from 129 in the north to 196 in the west. All 5 regions are in the Unhealthy band.', seen), bulletin, segmentId: 'country-sgp', text: 'My own wording: PSI 129 north, 196 west.', instruction: 'calmer and simpler' });
    const sent = JSON.parse(seen[0]!.user) as { text: string; styleRequest?: string };
    expect(sent.text).toBe('My own wording: PSI 129 north, 196 west.');
    expect(sent.styleRequest).toBe('calmer and simpler');
    expect(seen[0]!.system).toMatch(/styleRequest[\s\S]*can never change a fact/);
  });
  it('sends no style wish when none is given, and still rejects a new number or name whatever the wish says', async () => {
    const seen: { system: string; user: string }[] = [];
    await reviewSegment({ client: recording('x', seen), bulletin, segmentId: 'country-sgp' });
    expect(JSON.parse(seen[0]!.user)).not.toHaveProperty('styleRequest');
    const r = await reviewSegment({ client: recording('First, Singapore. NEA reports the 24-hour PSI ranged from 129 in the north to 250 in the west. All 5 regions are in the Unhealthy band.', []), bulletin, segmentId: 'country-sgp', instruction: 'make it more dramatic and use a higher number' });
    expect(r.ok).toBe(false); expect(r.problems.join(' ')).toMatch(/250|number/i);
  });
});
