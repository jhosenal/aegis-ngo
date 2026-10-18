import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Ground rules for the hazard-map prototype code (brief S0032), enforced by the build. The map pulses in red, which is exactly the kind of
// content that can harm a viewer, so the rules cover motion as well as the usual ones (tokens-only colours, no new package, same origin).
const root = process.cwd();
const dir = join(root, 'ui', 'src', 'prototype');
const uiSrc = join(root, 'ui', 'src');

function walk(base: string, accept: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(base)) {
    const path = join(base, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, accept)); else if (accept.test(name)) out.push(path);
  }
  return out;
}
const files = walk(dir, /\.(ts|tsx|css)$/).map((p) => ({ path: relative(root, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const screenFiles = files.filter((f) => !f.path.startsWith('ui/src/prototype/seam/'));

describe('hazard map prototype ground rules', () => {
  it('there is code to check', () => { expect(files.length).toBeGreaterThan(0); });

  it('colours come only from the design tokens: no hex, rgb, hsl or 0xRRGGBB literal (read tokens at run time with getComputedStyle)', () => {
    const bad = files.filter((f) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b0x[0-9a-fA-F]{6}\b/.test(code(f.text))).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it('imports only react, react-dom, three and relative files: no new package', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /\.(ts|tsx)$/.test(x.path))) {
      for (const m of f.text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = (m[1] ?? m[2] ?? m[3]) as string;
        if (spec.startsWith('.') || spec === 'react' || spec === 'react/jsx-runtime' || spec === 'react-dom' || spec.startsWith('react-dom/') || spec === 'three' || spec.startsWith('three/')) continue;
        bad.push(`${f.path}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no external address, no unsafe HTML or evaluation, no remote font, no remote image, no random numbers in the drawing', () => {
    const bad: string[] = [];
    for (const f of files) {
      const c = code(f.text);
      if (/https?:\/\//.test(c)) bad.push(`${f.path}: external URL`);
      if (/dangerouslySetInnerHTML|\beval\s*\(|new\s+Function\s*\(|innerHTML\s*=/.test(c)) bad.push(`${f.path}: unsafe HTML or evaluation`);
      if (/@import\s|@font-face/.test(c)) bad.push(`${f.path}: remote or custom font`);
      if (/Math\.random\s*\(/.test(c)) bad.push(`${f.path}: Math.random (the drawing must be reproducible)`);
    }
    expect(bad).toEqual([]);
  });

  it('references no image file except the seven domain icons', () => {
    const bad: string[] = [];
    for (const f of files) for (const m of f.text.matchAll(/['"`(]([^'"`()\s]*\.(?:png|jpe?g|webp|gif|avif))['"`)]/gi)) {
      if (!/brand\/domains\/(\$\{[^}]+\}|[a-z]+)\.png$/.test(m[1] as string)) bad.push(`${f.path}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  it('the screen reads data only through the provider seam', () => {
    expect(screenFiles.filter((f) => /content\/prototype|hazard-map\.stub/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it('once the screen exists: it honours reduced motion, blinks at 1 Hz or slower, and offers a pause control', () => {
    const screen = screenFiles.filter((f) => /\.(ts|tsx)$/.test(f.path) && f.path !== 'ui/src/prototype/HazardMapRoute.tsx');
    if (screen.length === 0) return;   // the placeholder has nothing to check yet
    const all = screen.map((f) => code(f.text)).join('\n');
    expect(all, 'respect prefers-reduced-motion').toMatch(/prefers-reduced-motion/);
    expect(all, 'a Pause control with aria-pressed').toMatch(/aria-pressed/);
    const hz = /\bBLINK_HZ\s*=\s*([0-9.]+)/.exec(all);
    expect(hz, 'export a BLINK_HZ constant').not.toBeNull();
    expect(Number(hz?.[1])).toBeGreaterThan(0);
    expect(Number(hz?.[1]), 'flashing faster than 1 Hz is not allowed').toBeLessThanOrEqual(1);
  });
});

// All CSS is one bundle: a prototype rule that styles a class used by another page would change that page (see overview-css-scope.test.ts).
describe('the prototype stylesheet cannot leak into other pages', () => {
  const cssFiles = files.filter((f) => f.path.endsWith('.css'));
  it('every selector made only of classes used elsewhere is scoped under .hazard-map-root', () => {
    if (cssFiles.length === 0) return;
    const foreign = new Set<string>();
    for (const file of walk(uiSrc, /\.(css|tsx|ts)$/).filter((p) => !p.startsWith(dir))) {
      const text = readFileSync(file, 'utf8');
      if (file.endsWith('.css')) for (const m of text.matchAll(/\.([A-Za-z_][\w-]*)/g)) foreign.add(m[1] as string);
      else for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) for (const t of ((m[1] ?? m[2]) as string).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (t) foreign.add(t);
    }
    const bad: string[] = [];
    for (const f of cssFiles) {
      for (const m of f.text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@;]+)\{/g)) {
        for (const part of (m[1] as string).split(',')) {
          const s = part.trim();
          if (s === '' || s.startsWith('.hazard-map-root') || /^(from|to|\d+(\.\d+)?%)/.test(s)) continue;
          const classes = [...s.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => x[1] as string);
          if (classes.length === 0 || classes.every((c) => foreign.has(c))) bad.push(`${f.path}: ${s.slice(0, 70)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('the guard exists even before the stylesheet does', () => {
    expect(existsSync(dir)).toBe(true);
  });
});
