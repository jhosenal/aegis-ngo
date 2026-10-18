// Isolated proof of concept: decision tables in a RESTRICTED rule language, validated before analysis, with an exhaustive coverage
// proof by finite partition. A rule is a conjunction of conditions, each an interval over one numeric field or a set of values of one
// enumerated field. Inside this language a rule's truth is constant on every cell of the partition formed by the breakpoints, so one
// representative per cell is exhaustive. Outside the language, or past the budget, nothing is claimed as proven.
import { add, cmp, div, fromInt, normalizeExternal, RationalError, type Rat } from './rational.js';

/** An optional, justified physical domain of a numeric field. Values outside it are REFUSED at evaluation (UNKNOWN), never clipped, and are not analysed by the prover. */
export interface Domain { lo: Rat | null; loIncl: boolean; hi: Rat | null; hiIncl: boolean; justification: string }
export interface NumericField { name: string; type: 'numeric'; domain?: Domain }
export interface EnumField { name: string; type: 'enum'; values: string[] }
export type Field = NumericField | EnumField;
export interface Interval { field: string; kind: 'interval'; lo: Rat | null; loIncl: boolean; hi: Rat | null; hiIncl: boolean }
export interface OneOf { field: string; kind: 'oneOf'; values: string[] }
export type Condition = Interval | OneOf;
export interface Rule { id: string; priority: number; outcome: string; when: Condition[] }
export interface Table { id: string; fields: Field[]; rules: Rule[]; defaultOutcome: string | null }

export type Value = Rat | string | 'UNKNOWN';
export type Witness = Record<string, string>;

export const TABLE_LIMITS = { maxFields: 16, maxRules: 200, maxPriority: 1000, maxEnumValues: 64, maxIdLength: 64, sampleCells: 10_000, maxJustification: 1000 };
const IDENT = /^[A-Za-z0-9_.-]+$/;

/** Validation comes first: invalid or unsupported input is an explicit refusal, never a vacuous proof. */
export function validateTable(table: Table): string[] {
  const errors: string[] = [];
  const fields = new Map<string, Field>();
  if (!Array.isArray(table.fields) || table.fields.length === 0) errors.push('NO_FIELDS');
  if (table.fields?.length > TABLE_LIMITS.maxFields) errors.push('TOO_MANY_FIELDS');
  for (const field of table.fields ?? []) {
    if (typeof field.name !== 'string' || !IDENT.test(field.name) || field.name.length > TABLE_LIMITS.maxIdLength) { errors.push(`BAD_FIELD_NAME ${String(field.name)}`); continue; }
    if (fields.has(field.name)) errors.push(`DUPLICATE_FIELD ${field.name}`);
    fields.set(field.name, field);
    if (field.type === 'enum') {
      if (!Array.isArray(field.values) || field.values.length === 0) errors.push(`EMPTY_ENUM_DOMAIN ${field.name}`);
      else if (field.values.length > TABLE_LIMITS.maxEnumValues) errors.push(`ENUM_TOO_LARGE ${field.name}`);
      else if (new Set(field.values).size !== field.values.length) errors.push(`DUPLICATE_ENUM_VALUE ${field.name}`);
    } else if (field.type !== 'numeric') errors.push(`UNSUPPORTED_FIELD_TYPE ${(field as { name: string }).name}`);
    else if (field.domain !== undefined) errors.push(...validateDomain(field.name, field.domain));
    if (field.type === 'enum' && (field as { domain?: unknown }).domain !== undefined) errors.push(`DOMAIN_ON_ENUM_FIELD ${field.name}`);
  }
  if (!Array.isArray(table.rules) || table.rules.length === 0) errors.push('NO_RULES');
  if (table.rules?.length > TABLE_LIMITS.maxRules) errors.push('TOO_MANY_RULES');
  const ruleIds = new Set<string>();
  for (const rule of table.rules ?? []) {
    if (typeof rule.id !== 'string' || !IDENT.test(rule.id)) { errors.push(`BAD_RULE_ID ${String(rule.id)}`); continue; }
    if (ruleIds.has(rule.id)) errors.push(`DUPLICATE_RULE ${rule.id}`);
    ruleIds.add(rule.id);
    if (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > TABLE_LIMITS.maxPriority) errors.push(`BAD_PRIORITY ${rule.id}`);
    if (typeof rule.outcome !== 'string' || rule.outcome === '' || rule.outcome === 'AMBIGUOUS' || rule.outcome === 'UNMATCHED') errors.push(`BAD_OUTCOME ${rule.id}`);
    if (!Array.isArray(rule.when) || rule.when.length === 0) errors.push(`EMPTY_CONDITIONS ${rule.id}`);
    const seenFields = new Set<string>();
    for (const condition of rule.when ?? []) {
      const field = fields.get(condition.field);
      if (!field) { errors.push(`UNKNOWN_FIELD ${rule.id}.${String(condition.field)}`); continue; }
      if (seenFields.has(condition.field)) errors.push(`REPEATED_FIELD_IN_RULE ${rule.id}.${condition.field}`);
      seenFields.add(condition.field);
      if (condition.kind === 'interval') {
        if (field.type !== 'numeric') errors.push(`TYPE_MISMATCH ${rule.id}.${condition.field}: interval on an enumerated field`);
        if (condition.lo === null && condition.hi === null) errors.push(`UNBOUNDED_INTERVAL ${rule.id}.${condition.field}`);
        if (condition.lo !== null && condition.hi !== null) {
          const c = cmp(condition.lo, condition.hi);
          if (c > 0 || (c === 0 && !(condition.loIncl && condition.hiIncl))) errors.push(`EMPTY_INTERVAL ${rule.id}.${condition.field}`);
        }
      } else if (condition.kind === 'oneOf') {
        if (field.type !== 'enum') errors.push(`TYPE_MISMATCH ${rule.id}.${condition.field}: value set on a numeric field`);
        else if (!Array.isArray(condition.values) || condition.values.length === 0 || condition.values.some((value) => !field.values.includes(value))) errors.push(`VALUE_OUTSIDE_DOMAIN ${rule.id}.${condition.field}`);
      } else errors.push(`UNSUPPORTED_OPERATOR ${rule.id}.${(condition as { field: string }).field}`);
    }
  }
  if (table.defaultOutcome !== null && (typeof table.defaultOutcome !== 'string' || table.defaultOutcome === '')) errors.push('BAD_DEFAULT_OUTCOME');
  return errors;
}

function validateDomain(name: string, domain: Domain): string[] {
  const errors: string[] = [];
  if (typeof domain.justification !== 'string' || domain.justification.trim() === '' || domain.justification.length > TABLE_LIMITS.maxJustification) errors.push(`DOMAIN_UNJUSTIFIED ${name}`);
  if (domain.lo === null && domain.hi === null) errors.push(`DOMAIN_UNBOUNDED ${name}`);
  if (domain.lo !== null && domain.hi !== null) {
    const c = cmp(domain.lo, domain.hi);
    if (c > 0 || (c === 0 && !(domain.loIncl && domain.hiIncl))) errors.push(`DOMAIN_EMPTY ${name}`);
  }
  return errors;
}

/** Is a value inside the field's declared domain? A field without a domain accepts every value (no claim is made). */
export function inDomain(field: Field, value: Rat | string): boolean {
  if (field.type !== 'numeric' || field.domain === undefined) return true;
  if (typeof value === 'string') return false;
  const d = field.domain;
  if (d.lo !== null) { const c = cmp(value, d.lo); if (c < 0 || (c === 0 && !d.loIncl)) return false; }
  if (d.hi !== null) { const c = cmp(value, d.hi); if (c > 0 || (c === 0 && !d.hiIncl)) return false; }
  return true;
}

const holds = (condition: Condition, value: Rat | string): boolean => {
  if (condition.kind === 'oneOf') return typeof value === 'string' && condition.values.includes(value);
  if (typeof value === 'string') return false;
  if (condition.lo !== null) { const c = cmp(value, condition.lo); if (c < 0 || (c === 0 && !condition.loIncl)) return false; }
  if (condition.hi !== null) { const c = cmp(value, condition.hi); if (c > 0 || (c === 0 && !condition.hiIncl)) return false; }
  return true;
};

const show = (value: Rat | string): string => (typeof value === 'string' ? value : `${value.n}/${value.d}`);

function representatives(field: Field, rules: Rule[]): (Rat | string)[] {
  if (field.type === 'enum') return [...field.values];
  const points: Rat[] = [];
  for (const rule of rules) for (const c of rule.when) if (c.field === field.name && c.kind === 'interval') {
    if (c.lo) points.push(c.lo);
    if (c.hi) points.push(c.hi);
  }
  if (field.domain?.lo) points.push(field.domain.lo);     // the domain edges are breakpoints too, so each cell is wholly inside or outside the domain
  if (field.domain?.hi) points.push(field.domain.hi);
  const sorted = points.sort((a, b) => cmp(a, b)).filter((point, index, all) => index === 0 || cmp(point, all[index - 1] as Rat) !== 0);
  if (sorted.length === 0) return [fromInt(0n)];
  const out: Rat[] = [add(sorted[0] as Rat, fromInt(-1n))];           // below every breakpoint
  sorted.forEach((point, index) => {
    out.push(point);                                                   // each breakpoint itself (boundary equality)
    const nextPoint = sorted[index + 1];
    out.push(nextPoint ? div(add(point, nextPoint), fromInt(2n)) : add(point, fromInt(1n)));   // the open gap after it
  });
  return out.filter((value) => inDomain(field, value));                // cells outside the declared domain are not analysed
}

export function effectiveOutcome(table: Table, cell: Record<string, Rat | string>): { outcome: string; matched: string[]; tie: boolean; usedDefault: boolean } {
  const matched = table.rules.filter((rule) => rule.when.every((condition) => holds(condition, cell[condition.field] as Rat | string)));
  if (matched.length === 0) return { outcome: table.defaultOutcome ?? 'UNMATCHED', matched: [], tie: false, usedDefault: table.defaultOutcome !== null };
  const top = Math.max(...matched.map((rule) => rule.priority));
  const winners = matched.filter((rule) => rule.priority === top);
  const outcomes = new Set(winners.map((rule) => rule.outcome));
  return { outcome: outcomes.size === 1 ? (winners[0] as Rule).outcome : 'AMBIGUOUS', matched: matched.map((rule) => rule.id), tie: outcomes.size > 1, usedDefault: false };
}

export interface Analysis {
  /** Was every cell of the partition examined? False when the table is invalid or the budget was exceeded: nothing is then proven. */
  analysisComplete: boolean;
  /** Accepted only when the language and domain are valid, the analysis is complete, no tie is unresolved, and every cell has an effective outcome (a rule or the explicit default). */
  tableAccepted: boolean;
  status: 'ACCEPTED' | 'REJECTED_COVERAGE' | 'REJECTED_AMBIGUITY' | 'INVALID_TABLE' | 'NOT_PROVEN';
  validationErrors: string[];
  cells: number;
  gaps: Witness[];
  ambiguities: { cell: Witness; rules: string[] }[];
  resolvedOverlaps: number;
  defaultCells: number;
  /** Only when the exhaustive analysis was not possible: a retained deterministic sample, labelled as tested coverage. It proves nothing about untested cells. */
  testedCoverage: { cells: number; gaps: Witness[]; ambiguities: { cell: Witness; rules: string[] }[] } | null;
  reason?: string;
}

const emptyAnalysis = (status: Analysis['status'], validationErrors: string[], cells: number, reason?: string): Analysis => ({
  analysisComplete: false, tableAccepted: false, status, validationErrors, cells, gaps: [], ambiguities: [], resolvedOverlaps: 0, defaultCells: 0, testedCoverage: null, ...(reason ? { reason } : {}),
});

function visit(table: Table, reps: (Rat | string)[][], index: number[], into: Analysis | NonNullable<Analysis['testedCoverage']>): { resolved: number; defaults: number } {
  const cell: Record<string, Rat | string> = {};
  table.fields.forEach((field, i) => { cell[field.name] = (reps[i] as (Rat | string)[])[index[i] as number] as Rat | string; });
  const result = effectiveOutcome(table, cell);
  const label = Object.fromEntries(Object.entries(cell).map(([k, v]) => [k, show(v)]));
  if (result.tie) into.ambiguities.push({ cell: label, rules: result.matched });
  else if (result.matched.length === 0 && !result.usedDefault) into.gaps.push(label);
  return { resolved: result.matched.length > 1 && !result.tie ? 1 : 0, defaults: result.matched.length === 0 && result.usedDefault ? 1 : 0 };
}

export function prove(table: Table, maxCells = 1_000_000): Analysis {
  const validationErrors = validateTable(table);
  if (validationErrors.length > 0) return emptyAnalysis('INVALID_TABLE', validationErrors, 0, 'the table is outside the supported rule language');
  const reps = table.fields.map((field) => representatives(field, table.rules));
  if (reps.some((list) => list.length === 0)) return emptyAnalysis('INVALID_TABLE', ['EMPTY_ANALYSIS_DOMAIN'], 0, 'a field has no analysable cell');
  const cells = reps.reduce((product, list) => product * list.length, 1);
  if (cells > maxCells) {
    // Budget exceeded: NOT_PROVEN. A deterministic sample is retained and labelled as tested coverage, never as a proof.
    const sample: NonNullable<Analysis['testedCoverage']> = { cells: 0, gaps: [], ambiguities: [] };
    let seed = 1n;
    for (let n = 0; n < TABLE_LIMITS.sampleCells; n += 1) {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);   // fixed LCG, so the sample is reproducible
      let rest = seed >> 11n;
      const index = reps.map((list) => { const size = BigInt(list.length); const pick = Number(rest % size); rest /= size; return pick; });
      visit(table, reps, index, sample);
      sample.cells += 1;
    }
    return { ...emptyAnalysis('NOT_PROVEN', [], cells, `partition of ${cells} cells exceeds the budget of ${maxCells}`), testedCoverage: sample };
  }
  const analysis: Analysis = { ...emptyAnalysis('ACCEPTED', [], cells), analysisComplete: true };
  const index = new Array<number>(table.fields.length).fill(0);
  for (let count = 0; count < cells; count += 1) {
    const step = visit(table, reps, index, analysis);
    analysis.resolvedOverlaps += step.resolved;
    analysis.defaultCells += step.defaults;
    for (let i = index.length - 1; i >= 0; i -= 1) {       // odometer
      index[i] = (index[i] as number) + 1;
      if (index[i] === (reps[i] as unknown[]).length) index[i] = 0; else break;
    }
  }
  analysis.status = analysis.ambiguities.length > 0 ? 'REJECTED_AMBIGUITY' : analysis.gaps.length > 0 ? 'REJECTED_COVERAGE' : 'ACCEPTED';
  analysis.tableAccepted = analysis.status === 'ACCEPTED';
  return analysis;
}

/** Runtime handling stays even when a table is accepted: an unknown input, an ambiguity or no match yields UNKNOWN, never nominal. */
export function evaluate(table: Table, values: Record<string, Value>): { outcome: string; reason: string | null } {
  const referenced = new Set(table.rules.flatMap((rule) => rule.when.map((c) => c.field)));
  for (const name of referenced) if (values[name] === 'UNKNOWN' || values[name] === undefined) return { outcome: 'UNKNOWN', reason: `INPUT_UNKNOWN:${name}` };
  for (const field of table.fields) if (referenced.has(field.name) && !inDomain(field, values[field.name] as Rat | string)) return { outcome: 'UNKNOWN', reason: `OUT_OF_DOMAIN:${field.name}` };
  const result = effectiveOutcome(table, values as Record<string, Rat | string>);
  if (result.tie) return { outcome: 'UNKNOWN', reason: 'AMBIGUOUS_RULES' };
  if (result.matched.length === 0 && !result.usedDefault) return { outcome: 'UNKNOWN', reason: 'NO_RULE_MATCHED' };
  return { outcome: result.outcome, reason: null };
}

/** Interval endpoints come through the SAME external-input limits as every other entry point (40 digits per component), never an ad hoc split. */
export const interval = (field: string, lo: string | null, loIncl: boolean, hi: string | null, hiIncl: boolean): Interval => {
  const parse = (text: string | null): Rat | null => {
    if (text === null) return null;
    try { return normalizeExternal(text); } catch (error: unknown) { throw error instanceof RationalError ? error : new Error('bad endpoint'); }
  };
  return { field, kind: 'interval', lo: parse(lo), loIncl, hi: parse(hi), hiIncl };
};
/** A justified physical domain; endpoints use the same external-input limits as interval endpoints. */
export const domain = (lo: string | null, loIncl: boolean, hi: string | null, hiIncl: boolean, justification: string): Domain => {
  const parse = (text: string | null): Rat | null => (text === null ? null : normalizeExternal(text));
  return { lo: parse(lo), loIncl, hi: parse(hi), hiIncl, justification };
};
export const oneOf = (field: string, ...values: string[]): OneOf => ({ field, kind: 'oneOf', values });
