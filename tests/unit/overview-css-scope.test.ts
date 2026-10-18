import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// All CSS of the app is bundled into one file, so a rule in the overview stylesheet reaches every page. An unscoped `.sheet-backdrop::before` in
// ui/src/overview/overview.css once painted a dark layer over the Cards sheet of the public Assist page and made it unclickable on a phone.
// Guard: a class that the overview stylesheet styles WITHOUT the `.overview-root` scope must not be used by any other page, and the stylesheet
// must not style bare elements, `*` or pseudo-roots without the scope.
const root = process.cwd();
const uiSrc = join(root, 'ui', 'src');
const overviewDir = join(uiSrc, 'overview');

function walk(dir: string, accept: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, accept)); else if (accept.test(name)) out.push(path);
  }
  return out;
}

function selectorsOf(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of clean.matchAll(/([^{}@;]+)\{/g)) {
    const block = (m[1] as string).trim();
    if (block === '' || /^(from|to|\d+(\.\d+)?%)/.test(block)) continue;
    for (const part of block.split(',')) { const s = part.trim(); if (s !== '') out.push(s); }
  }
  return out;
}
const classesIn = (selector: string): string[] => [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1] as string);

const overviewCss = readFileSync(join(overviewDir, 'overview.css'), 'utf8');
const unscoped = selectorsOf(overviewCss).filter((s) => !s.startsWith('.overview-root'));

// every class used by the rest of the app: in other stylesheets and in className strings of other components
const foreign = new Set<string>();
for (const file of walk(uiSrc, /\.(css|tsx|ts)$/).filter((f) => !f.startsWith(overviewDir))) {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.css')) for (const s of selectorsOf(text)) for (const c of classesIn(s)) foreign.add(c);
  else for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const value = ((m[1] ?? m[2] ?? m[3]) as string).replace(/\$\{[^}]*\}/g, ' ');
    for (const token of value.split(/\s+/)) if (/^[A-Za-z_][\w-]*$/.test(token)) foreign.add(token);
  }
}

describe('the overview stylesheet cannot leak into other pages', () => {
  it('there are selectors to check', () => {
    expect(selectorsOf(overviewCss).length).toBeGreaterThan(50);
    expect(foreign.size).toBeGreaterThan(50);
  });

  it('no selector made only of classes used by other pages or the shared components is left without the .overview-root scope', () => {
    const collisions = new Set<string>();
    for (const selector of unscoped) {
      const classes = classesIn(selector);
      // a selector that also names a class unique to the overview (for example `.overview-main-layout > .divider`) is scoped by that class
      if (classes.length > 0 && classes.every((c) => foreign.has(c))) collisions.add(selector.slice(0, 80));
    }
    expect([...collisions], 'scope these selectors under .overview-root').toEqual([]);
  });

  it('no bare element, universal, root or body rule is left unscoped', () => {
    const bare = unscoped.filter((s) => /^(\*|:root|html|body|main|header|nav|section|article|aside|button|input|a|h[1-6]|p|ul|ol|li|label|img|svg|table|th|td|dialog)\b/.test(s)).map((s) => s.slice(0, 70));
    expect(bare).toEqual([]);
  });

  it('the guard itself works: it would have caught the sheet-backdrop rule', () => {
    const sample = selectorsOf('.drawer-backdrop::before, .sheet-backdrop::before { content: "" }').filter((s) => !s.startsWith('.overview-root'));
    expect(sample.flatMap(classesIn)).toContain('sheet-backdrop');
    expect(foreign.has('sheet-backdrop')).toBe(true);
  });
});
