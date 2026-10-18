import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HAZARD_TYPES, HazardMapSchema, SEVERITY_ORDER } from '../../src/prototype/hazard-map.js';

// The contract and the synthetic stub of the hazard-map prototype.
const root = process.cwd();
const raw = JSON.parse(readFileSync(join(root, 'content', 'prototype', 'hazard-map.stub.json'), 'utf8')) as unknown;
const stub = HazardMapSchema.parse(raw);
const catalogue = JSON.parse(readFileSync(join(root, 'content', 'domains', 'catalogue.json'), 'utf8')) as { domains: { name: string }[] };

describe('hazard map contract and stub', () => {
  it('the stub is valid, marked synthetic and schematic', () => {
    expect(stub.synthetic).toBe(true);
    expect(stub.syntheticLabel).toMatch(/synthetic/i);
    expect(stub.frame.schematic).toBe(true);
  });

  it('the seven hazard kinds are exactly the seven domains of the catalogue, and the stub shows every kind at least once', () => {
    expect([...HAZARD_TYPES].sort()).toEqual(catalogue.domains.map((d) => d.name.toLowerCase()).sort());
    const present = new Set(stub.events.map((e) => e.type));
    for (const t of HAZARD_TYPES) expect(present.has(t), t).toBe(true);
  });

  it('shows every severity, so the pulse and the colours can be tested at each level', () => {
    expect(new Set(stub.events.map((e) => e.severity))).toEqual(new Set(Object.keys(SEVERITY_ORDER)));
  });

  it('every area lies inside the frame, with a sensible radius, and every icon file exists', () => {
    for (const e of stub.events) {
      expect(e.x - e.radius, `${e.id} left edge`).toBeGreaterThanOrEqual(-1);
      expect(e.x + e.radius, `${e.id} right edge`).toBeLessThanOrEqual(101);
      expect(e.y - e.radius * 0.6, `${e.id} top edge`).toBeGreaterThanOrEqual(-1);
    }
    for (const t of HAZARD_TYPES) expect(readFileSync(join(root, 'ui', 'public', 'brand', 'domains', `${t}.png`)).length).toBeGreaterThan(500);
  });

  it('names are fictional and generic: no real place, no coordinates, no URL, no person', () => {
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/https?:|\.png|\.jpg|\blat(itude)?\b|\blon(gitude)?\b/i);
    for (const e of stub.events) expect(e.label).toMatch(/^[A-Za-z ]+ \d+$/);
  });

  it('the contract refuses an unmarked synthetic map, a duplicate event, an area outside the frame and an unknown kind', () => {
    expect(HazardMapSchema.safeParse({ ...stub, syntheticLabel: 'Demonstration.' }).success).toBe(false);
    expect(HazardMapSchema.safeParse({ ...stub, events: [stub.events[0], stub.events[0]] }).success).toBe(false);
    expect(HazardMapSchema.safeParse({ ...stub, events: [{ ...stub.events[0], x: 140 }] }).success).toBe(false);
    expect(HazardMapSchema.safeParse({ ...stub, events: [{ ...stub.events[0], type: 'tsunami' }] }).success).toBe(false);
    expect(HazardMapSchema.safeParse({ ...stub, extra: 1 }).success).toBe(false);
  });
});
