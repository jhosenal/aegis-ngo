import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OverviewSchema, formatCount } from '../../src/overview/contract.js';

// The design colours (D0001 to D0004) as tokens, the data contract of the overview screen, and its synthetic stub.
interface Token { hex: string; origin: 'sampled' | 'chosen'; use: string }
interface Tokens { version: number; colors: Record<string, Token>; textPairs: { fg: string; bg: string; min: number }[] }
const root = process.cwd();
const tokens = JSON.parse(readFileSync(join(root, 'ui', 'src', 'design', 'tokens.json'), 'utf8')) as Tokens;
const css = readFileSync(join(root, 'ui', 'src', 'design', 'tokens.css'), 'utf8');

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
}
const ratio = (a: string, b: string): number => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };
const kebab = (name: string): string => name.replace(/([A-Z])/g, '-$1').toLowerCase();

describe('design tokens', () => {
  it('every colour is a six-digit hex and says where it came from', () => {
    for (const [name, t] of Object.entries(tokens.colors)) {
      expect(t.hex, name).toMatch(/^#[0-9A-F]{6}$/);
      expect(['sampled', 'chosen'], name).toContain(t.origin);
      expect(t.use.length, name).toBeGreaterThan(5);
    }
  });

  it('every text pair reaches its contrast ratio (4.5 for body text, 7 for headings and numbers, 3 for the large badge number)', () => {
    const failures: string[] = [];
    for (const p of tokens.textPairs) {
      const fg = tokens.colors[p.fg]; const bg = tokens.colors[p.bg];
      expect(fg, `unknown token ${p.fg}`).toBeDefined(); expect(bg, `unknown token ${p.bg}`).toBeDefined();
      const r = ratio((fg as Token).hex, (bg as Token).hex);
      if (r < p.min) failures.push(`${p.fg} on ${p.bg}: ${r.toFixed(2)} < ${p.min}`);
    }
    expect(failures).toEqual([]);
  });

  it('the CSS file defines every token with the same value, so the stylesheet cannot drift from the checked tokens', () => {
    for (const [name, t] of Object.entries(tokens.colors)) {
      const match = new RegExp(`--aeg-${kebab(name)}:\\s*(#[0-9A-Fa-f]{6})\\s*;`).exec(css);
      expect(match, `--aeg-${kebab(name)} missing in tokens.css`).not.toBeNull();
      expect((match as RegExpExecArray)[1]?.toUpperCase(), name).toBe(t.hex);
    }
  });

  it('the sampled brand colours are the logo colours', () => {
    expect(tokens.colors.brandNavy?.hex).toBe('#09356E');
    expect(tokens.colors.brandCyan?.hex).toBe('#00B7E5');
  });
});

describe('overview contract and its synthetic stub', () => {
  const stub = JSON.parse(readFileSync(join(root, 'content', 'overview', 'stub-haze-incident.json'), 'utf8')) as unknown;

  it('the stub is valid, marked synthetic, and says so in its label', () => {
    const parsed = OverviewSchema.parse(stub);
    expect(parsed.synthetic).toBe(true);
    expect(parsed.syntheticLabel).toMatch(/synthetic/i);
    expect(parsed.map.schematic).toBe(true);
  });

  it('the stub numbers agree with each other: group counts add up to the people at risk, shares to about 100, shortfall = requested - available', () => {
    const o = OverviewSchema.parse(stub);
    expect(o.groups.reduce((s, g) => s + (g.count ?? 0), 0)).toBe(o.kpis.peopleAtRisk.total);
    for (const row of o.shortfall) expect(row.shortfall).toBe((row.requested ?? 0) - (row.available ?? 0));
    expect(o.kpis.resourceShortfall.criticalItems).toBe(o.shortfall.length);
    expect(o.map.areas.length).toBe(o.kpis.affectedAreas.count);
  });

  it('holds no photograph, no person and no real place: icons are glyph names and there is no URL anywhere', () => {
    const text = JSON.stringify(stub);
    expect(text).not.toMatch(/https?:|\.png|\.jpg|\.jpeg|\.webp|data:image/i);
    for (const area of OverviewSchema.parse(stub).map.areas) expect(area.name).toMatch(/^Community \d+$/);
  });

  it('an unknown value is null and is shown as Unknown, never as 0', () => {
    expect(formatCount(null)).toBe('Unknown');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12480)).toBe('12,480');
    const o = OverviewSchema.parse(stub);
    const unknown = { ...o, kpis: { ...o.kpis, peopleAtRisk: { ...o.kpis.peopleAtRisk, total: null } } };
    expect(OverviewSchema.safeParse(unknown).success).toBe(true);
  });

  it('the contract refuses an unmarked synthetic overview, an impossible shortfall and groups that do not add up', () => {
    const o = OverviewSchema.parse(stub);
    expect(OverviewSchema.safeParse({ ...o, syntheticLabel: 'Demonstration data.' }).success).toBe(false);
    expect(OverviewSchema.safeParse({ ...o, shortfall: [{ ...o.shortfall[0], shortfall: 99999 }] }).success).toBe(false);
    expect(OverviewSchema.safeParse({ ...o, groups: o.groups.map((g) => ({ ...g, sharePercent: 10 })) }).success).toBe(false);
    expect(OverviewSchema.safeParse({ ...o, extra: 1 }).success).toBe(false);
  });

  it('the honest footnote of the assist panel says that no model is used in this preview', () => {
    expect(OverviewSchema.parse(stub).assist.footnote).toMatch(/No AI model is used/);
  });
});
