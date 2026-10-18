// S0004: the real seven SOP tables (Luna's literal v2 translations, unchanged) proved twice: unbounded, and with the justified
// physical domains from research/formulation/bounds/field-bounds.json attached. Fields marked "unjustified" stay unbounded.
// Output is diagnostic only; no table is accepted, promoted or activated by this script.
import { readdirSync, readFileSync } from 'node:fs';
import { domain, interval, oneOf, prove, type Field, type Table } from './decisiontable.js';

const dir = new URL('../formulation/tables/', import.meta.url);
const bounds = JSON.parse(readFileSync(new URL('../formulation/bounds/field-bounds.json', import.meta.url), 'utf8')) as { fields?: unknown[]; bounds?: unknown[] } | unknown[];
const list = (Array.isArray(bounds) ? bounds : (bounds.fields ?? bounds.bounds ?? [])) as { field: string; kind: string; lo: string | null; hi: string | null; loIncl: boolean | null; hiIncl: boolean | null; justification: string }[];
const byField = new Map(list.map((b) => [b.field, b]));

type V = { id: string; fields: ({ name: string; type: string; values?: string[] })[]; rules: { id: string; priority: number; outcome: string; when: ({ kind: 'interval'; field: string; lo: string | null; loIncl: boolean; hi: string | null; hiIncl: boolean } | { kind: 'oneOf'; field: string; values: string[] })[] }[]; untranslatable: unknown[]; defaultOutcome: string | null };

const build = (v: V, bounded: boolean): Table => ({
  id: v.id,
  defaultOutcome: v.defaultOutcome,
  fields: v.fields.map((f): Field => {
    if (f.type !== 'numeric') return { name: f.name, type: 'enum', values: f.values ?? [] };
    const b = byField.get(f.name);
    if (!bounded || !b || b.kind === 'unjustified') return { name: f.name, type: 'numeric' };
    return { name: f.name, type: 'numeric', domain: domain(b.lo, b.loIncl ?? false, b.hi, b.hiIncl ?? false, b.justification) };
  }),
  rules: v.rules.map((r) => ({ id: r.id, priority: r.priority, outcome: r.outcome, when: r.when.map((c) => (c.kind === 'interval' ? interval(c.field, c.lo, c.loIncl, c.hi, c.hiIncl) : oneOf(c.field, ...c.values))) })),
});

const negative = (w: Record<string, string>[]): number => w.filter((cell) => Object.values(cell).some((x) => x.startsWith('-'))).length;
const rows: string[] = [];
for (const name of readdirSync(dir).filter((n) => n.endsWith('-v2.json')).sort()) {
  const spec = JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as { variants: V[] };
  for (const v of spec.variants) {
    const open = prove(build(v, false));
    const closed = prove(build(v, true));
    const tag = v.untranslatable.length > 0 ? ' (+untranslatable: NOT_PROVEN)' : '';
    rows.push([v.id.padEnd(30), `unbounded ${open.status} cells ${open.cells} gaps ${open.gaps.length} amb ${open.ambiguities.length}`.padEnd(64),
      `bounded ${closed.status} cells ${closed.cells} gaps ${closed.gaps.length} amb ${closed.ambiguities.length} negativeWitnesses ${negative(closed.gaps.map((g) => g)) + negative(closed.ambiguities.map((a) => a.cell))}${tag}`].join(' | '));
  }
}
process.stdout.write(rows.join('\n') + '\n');
// which fields still produce negative witnesses (only a field without a justified bound can)?
const culprit = new Map<string, number>();
for (const name of readdirSync(dir).filter((n) => n.endsWith('-v2.json')).sort()) {
  const spec = JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as { variants: V[] };
  for (const v of spec.variants) {
    const a = prove(build(v, true));
    for (const cell of [...a.gaps, ...a.ambiguities.map((x) => x.cell)]) for (const [k, x] of Object.entries(cell)) if (x.startsWith('-')) culprit.set(`${v.id}.${k}`, (culprit.get(`${v.id}.${k}`) ?? 0) + 1);
  }
}
// Astra (2026-10-14): a witness is only a MATHEMATICAL witness (a point of the partition) unless every field in it has a justified
// bound; a witness that touches a field without a justified bound is not a physically established case.
const unboundedFields = new Set(list.filter((b) => b.kind === 'unjustified').map((b) => b.field));
process.stdout.write('fields without a justified bound (their witnesses are mathematical only, not physically established): ' + JSON.stringify([...unboundedFields]) + '\n');
process.stdout.write('fields with negative witnesses: ' + JSON.stringify(Object.fromEntries(culprit)) + '\n');
