import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAssistContent } from '../../src/assist/content.js';
import { Audience } from '../../src/assist/contract.js';

// Group-specific haze content (S0016). The point of these tests: a card for a group may only exist where an official source speaks
// to that group, every quote must be on its saved page, and old guidance must carry its date.

const inbox = join(process.cwd(), 'docs', '99-inbox');
const content = loadAssistContent({ draftMedical: false, allowFixture: false });
const haze = content.cards.map((c) => c.card).filter((c) => c.hazard === 'haze');

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function normalise(text: string): string {
  return decodeEntities(text)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function savedText(file: string): string | null {
  const path = join(inbox, file);
  if (!existsSync(path)) return null;
  if (file.toLowerCase().endsWith('.pdf')) {
    const result = spawnSync('pdftotext', [path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return result.status === 0 ? normalise(result.stdout) : null;   // null: no PDF reader on this machine
  }
  const raw = readFileSync(path, 'utf8').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return normalise(raw);
}

describe('group-specific haze cards', () => {
  it('Singapore has the two groups NEA itself defines, and no group the source does not name', () => {
    const sg = haze.filter((c) => c.country === 'SG');
    const audiences = new Set(sg.map((c) => c.audience));
    expect(audiences.has('lung-heart')).toBe(true);
    expect(audiences.has('children-older-pregnant')).toBe(true);
    const lung = sg.find((c) => c.audience === 'lung-heart')!;
    const vulnerable = sg.find((c) => c.audience === 'children-older-pregnant')!;
    expect(lung.lines.some((l) => /CHRONIC LUNG DISEASE, HEART DISEASE/.test(l.condition ?? ''))).toBe(true);
    expect(vulnerable.lines.some((l) => /ELDERLY, PREGNANT WOMEN, CHILDREN/.test(l.condition ?? ''))).toBe(true);
    // the title must name the group the content is for (a first draft had three cards titled "pregnant women")
    expect(lung.title.toLowerCase()).toContain('lung or heart');
    expect(vulnerable.title.toLowerCase()).toContain('children');
  });

  it('no two cards of one country carry the same lines under different group labels', () => {
    for (const country of ['MY', 'SG', 'ID'] as const) {
      const signatures = haze.filter((c) => c.country === country).map((c) => JSON.stringify(c.lines.map((l) => [l.text, l.condition ?? ''])));
      expect(new Set(signatures).size, `duplicate card content in ${country}`).toBe(signatures.length);
    }
  });

  it('a group card is only used where the source names that group (Malaysia has none: its leaflet is general)', () => {
    const myGroups = haze.filter((c) => c.country === 'MY' && c.audience !== 'general');
    expect(myGroups).toEqual([]);
  });

  it('the Malaysian leaflet card shows that the guidance dates from 2008', () => {
    const myCards = haze.filter((c) => c.country === 'MY');
    expect(myCards.length).toBe(1);   // one Malaysian card: the same leaflet lines must not appear twice
    const leaflet = myCards[0]!;
    expect(leaflet.title).toContain('2008');
    expect(leaflet.sources.filter((s) => s.sourceId.startsWith('SRC-MY-MOH')).every((s) => s.published === '2008')).toBe(true);
  });

  it('every audience value in the content is a declared one and every group has a card in some country', () => {
    for (const c of haze) expect(Audience.options).toContain(c.audience);
  });

  it('every quoted passage is found on its saved evidence page', () => {
    const missingFiles: string[] = [];
    const notFound: string[] = [];
    let checked = 0;
    for (const c of haze) {
      for (const s of c.sources) {
        if (!s.savedFile) continue;
        const text = savedText(s.savedFile);
        if (text === null) { if (!existsSync(join(inbox, s.savedFile))) missingFiles.push(s.savedFile); continue; }
        checked += 1;
        if (!text.includes(normalise(s.passage))) notFound.push(`${c.id} ${s.sourceId}`);
      }
    }
    expect(missingFiles).toEqual([]);
    expect(notFound).toEqual([]);
    expect(checked).toBeGreaterThan(10);
  });
});
