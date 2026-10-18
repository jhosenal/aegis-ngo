import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Ground rules for the overview screen code (brief S0024), enforced by the build so they hold whoever writes the screen:
// colours come only from the design tokens, no new packages, no external addresses, no unsafe HTML or code evaluation, and no photographs.
const root = process.cwd();
const overviewDir = join(root, 'ui', 'src', 'overview');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path)); else if (/\.(ts|tsx|css)$/.test(name)) out.push(path);
  }
  return out;
}
const sources = files(overviewDir).map((path) => ({ path: relative(root, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));
// the engineer's data seam may import the stub JSON; the screen code may not read the content folder directly
const screenSources = sources.filter((s) => !s.path.startsWith('ui/src/overview/seam/'));

describe('overview screen ground rules', () => {
  it('there is code to check (the placeholder at least)', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('colours come only from the design tokens: no hex or rgb() literal in any overview file', () => {
    const offenders: string[] = [];
    for (const s of sources) {
      const code = s.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/#[0-9a-fA-F]{3,8}\b/.test(code) || /\brgba?\(/.test(code) || /\bhsla?\(/.test(code)) offenders.push(s.path);
    }
    expect(offenders, 'use var(--aeg-...) from ui/src/design/tokens.css instead of a literal colour').toEqual([]);
  });

  it('imports only react, react-dom and relative files: no new package', () => {
    const bad: string[] = [];
    for (const s of sources.filter((x) => /\.(ts|tsx)$/.test(x.path))) {
      for (const m of s.text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
        const spec = (m[1] ?? m[2]) as string;
        if (spec.startsWith('.')) continue;
        if (spec === 'react' || spec === 'react-dom' || spec.startsWith('react-dom/') || spec === 'react/jsx-runtime') continue;
        bad.push(`${s.path}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no external address, no unsafe HTML, no code evaluation, no remote font or image', () => {
    const bad: string[] = [];
    for (const s of sources) {
      const code = s.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/https?:\/\//.test(code)) bad.push(`${s.path}: external URL`);
      if (/dangerouslySetInnerHTML|\beval\s*\(|new\s+Function\s*\(|innerHTML\s*=/.test(code)) bad.push(`${s.path}: unsafe HTML or evaluation`);
      if (/@import\s|@font-face|fonts\.googleapis/.test(code)) bad.push(`${s.path}: remote or custom font`);
    }
    expect(bad).toEqual([]);
  });

  it('the screen reads data only through the provider seam, never the content folder or the stub file directly', () => {
    const bad = screenSources.filter((s) => /content\/overview|stub-haze-incident/.test(s.text)).map((s) => s.path);
    expect(bad).toEqual([]);
  });

  it('shows no photograph: no image file other than the logo and the seven domain icons is referenced', () => {
    const bad: string[] = [];
    for (const s of sources) {
      for (const m of s.text.matchAll(/['"(]([^'"()]*\.(?:png|jpe?g|webp|gif|avif))['")]/gi)) {
        // the logo and the owner's seven domain icons (brand/domains/*.png) are the only image files the overview may reference
        if (!/brand\/(?:aegis-ngo-logo\.webp|domains\/[a-z]+\.png)$/.test(m[1] as string)) bad.push(`${s.path}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
