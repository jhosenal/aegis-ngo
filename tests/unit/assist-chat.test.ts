import { describe, expect, it } from 'vitest';
import { loadAssistContent } from '../../src/assist/content.js';
import { answer, MAX_ACTIVITY_LINES, MAX_LINES, QUICK_QUESTIONS, type ChatBlock, type ChatContext } from '../../src/assist/chat.js';

// The chat answers only with verbatim card lines and their sources. These tests run it against the real shipped content.
const cards = loadAssistContent({ draftMedical: false, allowFixture: false }).cards.map((c) => c.card);
const my: ChatContext = { country: 'MY', audience: 'general' };
const sg: ChatContext = { country: 'SG', audience: 'general' };
const lines = (blocks: ChatBlock[]) => blocks.filter((b): b is Extract<ChatBlock, { kind: 'line' }> => b.kind === 'line');
const allCardLines = new Set(cards.flatMap((c) => c.lines.map((l) => l.text)));

describe('the Assist chat answers only from the cards', () => {
  it('emergency number: the chosen country\'s own sourced line, never another country\'s', () => {
    const r = answer('What is the emergency number?', cards, my);
    expect(r.topic).toBe('emergency');
    expect(lines(r.blocks).map((l) => l.text).join(' ')).toMatch(/999/);
    expect(JSON.stringify(r.blocks)).not.toMatch(/\b995\b/);
    const inSg = answer('emergency number', cards, sg);
    expect(JSON.stringify(inSg.blocks)).toMatch(/\b995\b/);
    expect(JSON.stringify(inSg.blocks)).not.toMatch(/call 999/i);
  });

  it('naming a country switches to it and says so through `set`', () => {
    const r = answer('I am in Singapore, what is the emergency number', cards, my);
    expect(r.set).toEqual({ country: 'SG' });
    expect(JSON.stringify(r.blocks)).toMatch(/\b995\b/);
    expect(answer('emergency number', cards, my).set).toBeUndefined();
  });

  it('masks in Singapore: the mask line and its caveat both come back, each with the publisher, link and access date', () => {
    const r = answer('Which mask should I wear?', cards, sg);
    expect(r.topic).toBe('mask');
    const texts = lines(r.blocks).map((l) => l.text).join(' | ');
    expect(texts).toMatch(/may wear an N95 mask/);
    expect(texts).toMatch(/consult their doctor before using an N95 mask/);
    for (const l of lines(r.blocks)) {
      expect(l.source.publisher.length).toBeGreaterThan(0);
      expect(l.source.url.startsWith('https://')).toBe(true);
      expect(l.source.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('masks in Malaysia carry the date of the 2008 leaflet', () => {
    const r = answer('mask', cards, my);
    const mask = lines(r.blocks).find((l) => /N95 or P100/.test(l.text));
    expect(mask?.source.published).toBe('2008');
  });

  it('outdoor activity for a lung or heart group gives that group\'s advice, with its band in the line', () => {
    const r = answer('Can I go outdoors? I have asthma', cards, sg);
    expect(r.set).toEqual({ audience: 'lung-heart' });
    const l = lines(r.blocks);
    expect(l.length).toBeGreaterThan(0);
    expect(l.some((x) => /PSI 101-200/.test(x.condition ?? '') && /Avoid/.test(x.text))).toBe(true);
    expect(l.every((x) => /lung or heart|Haze/.test(x.cardTitle))).toBe(true);
  });

  it('outdoor activity with no group named shows the whole table, every line naming its group, and is not cut in the middle', () => {
    const r = answer('Can I go outdoors?', cards, sg);
    expect(r.topic).toBe('activity');
    const l = lines(r.blocks);
    expect(l.length).toBe(15);
    for (const group of [/healthy persons/i, /elderly, pregnant women, children/i, /chronic lung disease, heart disease/i]) expect(l.filter((x) => group.test(x.text)).length).toBe(5);
  });

  it('where only group cards hold the activity advice, a question with no group asks for the group', () => {
    const groupCardsOnly = cards.filter((c) => c.audience !== 'general');
    const r = answer('Can I go outdoors?', groupCardsOnly, sg);
    expect(lines(r.blocks)).toEqual([]);
    expect(JSON.stringify(r.blocks)).toMatch(/depends on the group/);
  });

  it('a group with no card in that country is told so plainly, and gets the general guidance', () => {
    const r = answer('what about children', cards, my);
    expect(r.topic).toBe('group');
    expect(JSON.stringify(r.blocks)).toMatch(/No official guidance written for this group was found for Malaysia yet/);
    expect(lines(r.blocks).length).toBeGreaterThan(0);
  });

  it('danger words give the sourced contact line and a plain limit, never an assessment', () => {
    const r = answer('my grandfather cannot breathe and has chest pain', cards, sg);
    expect(r.topic).toBe('danger');
    expect(lines(r.blocks).map((l) => l.text)).toEqual(['SCDF Ambulance and Fire Service 995']);
    expect(JSON.stringify(r.blocks)).toMatch(/cannot assess symptoms/);
  });

  it('an unmatched question is said to be unmatched, with only the contact line and no health advice', () => {
    const r = answer('what is the weather tomorrow', cards, my);
    expect(r.topic).toBe('unknown');
    expect(JSON.stringify(r.blocks)).toMatch(/could not match/);
    expect(lines(r.blocks).length).toBeLessThanOrEqual(2);
  });

  it('Indonesia has no checked guidance, and the chat says so instead of inventing any', () => {
    const r = answer('Which mask should I wear in Jakarta?', cards, my);
    expect(r.set).toEqual({ country: 'ID' });
    expect(lines(r.blocks)).toEqual([]);
    expect(JSON.stringify(r.blocks)).toMatch(/did not find official guidance about masks for Indonesia/);
  });

  it('an empty question shows what can be asked', () => {
    expect(answer('   ', cards, my).topic).toBe('help');
  });

  it('every quick question gets a real, sourced answer from the shipped content in Malaysia and Singapore', () => {
    for (const q of QUICK_QUESTIONS) {
      for (const ctx of [my, sg]) {
        const r = answer(q.question, cards, ctx);
        expect(r.blocks.length, `${q.label} in ${ctx.country}`).toBeGreaterThan(0);
        expect(lines(r.blocks).length, `${q.label} in ${ctx.country}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the chat can never say anything that is not on a card', () => {
  it('property: over 600 random questions every reply line is verbatim card text with a source, capped, and nothing throws', () => {
    const vocab = ['mask', 'n95', 'emergency', 'number', 'singapore', 'malaysia', 'indonesia', 'jakarta', 'asthma', 'children', 'elderly', 'pregnant', 'doctor', 'outdoors', 'psi', 'help', 'ambulance', 'weather', 'hello', 'cannot', 'breathe', 'chest', 'pain', 'school', 'exercise', 'cure', 'vaccine', 'tomorrow', 'purifier', 'medication'];
    let seed = 987654;
    const rand = (max: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % max; };
    const ctxs: ChatContext[] = [my, sg, { country: 'ID', audience: 'general' }, { country: 'SG', audience: 'lung-heart' }, { country: 'SG', audience: 'children-older-pregnant' }];
    for (let i = 0; i < 600; i += 1) {
      const q = Array.from({ length: 1 + rand(6) }, () => vocab[rand(vocab.length)]).join(' ');
      const r = answer(q, cards, ctxs[rand(ctxs.length)] as ChatContext);
      const l = lines(r.blocks);
      expect(l.length).toBeLessThanOrEqual(r.topic === 'activity' ? MAX_ACTIVITY_LINES : MAX_LINES);
      for (const b of l) {
        expect(allCardLines.has(b.text), `"${b.text}" for "${q}"`).toBe(true);
        expect(b.source.publisher.length).toBeGreaterThan(0);
      }
      if (r.topic === 'danger') expect(l.length).toBeLessThanOrEqual(2);
    }
  });

  it('the texts the chat writes itself contain no health instruction: only lead-ins, limits and things to ask', () => {
    const replies = [answer('weather', cards, my), answer('mask', cards, my), answer('doctor', cards, { country: 'ID', audience: 'general' }), answer('children', cards, my), answer('pain cannot breathe', cards, my)];
    const authored = replies.flatMap((r) => r.blocks.filter((b) => b.kind !== 'line').map((b) => (b as { text: string }).text));
    for (const t of authored) expect(t, t).not.toMatch(/\b(you should|you must|do not|don't|take|drink|wear a|avoid)\b/i);
  });
});
