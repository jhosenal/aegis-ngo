import { AegisError } from '../../engine/errors.js';
import { canonicalize } from '../../engine/canonical.js';
import type { IdGen } from '../../engine/ids.js';
import type { Db } from '../db.js';
import {
  MAX_CARD_DEPTH,
  type CardBody,
  type CardKind,
  type CardLink,
  type CardRevision,
  type CardState,
} from '../../types/domain.js';

export interface NewCardRevision {
  tenantId: string;
  cardId?: string;
  kind: CardKind;
  title: string;
  body: CardBody;
  evidenceIds: string[];
  formulationRef: string | null;
  workflowRunId: string | null;
  createdBy: string;
  state: CardState;
}

export interface CardSummary {
  cardId: string;
  tenantId: string;
  kind: CardKind;
  revision: number;
  state: CardState;
  title: string;
  createdAt: string;
}

export interface CardRevisionSummary {
  revision: number;
  state: CardState;
  createdAt: string;
}

interface CardRevisionRow {
  card_id: string;
  tenant_id: string;
  kind: string;
  revision: number;
  state: string;
  title: string;
  body_json: string;
  evidence_ids_json: string;
  formulation_ref: string | null;
  workflow_run_id: string | null;
  created_at: string;
  created_by: string;
}

interface LinkRow {
  parent_card_id: string;
  parent_revision: number;
  child_card_id: string;
  child_revision: number;
  relation: CardLink['relation'];
}

interface CardSummaryRow {
  card_id: string;
  tenant_id: string;
  kind: string;
  revision: number;
  state: string;
  title: string;
  created_at: string;
}

function parseCardKind(value: string): CardKind | null {
  switch (value) {
    case 'incident':
    case 'resource':
    case 'assessment':
    case 'evidence':
    case 'note':
      return value;
    default:
      return null;
  }
}

function parseCardState(value: string): CardState | null {
  switch (value) {
    case 'draft':
    case 'validated':
    case 'reviewed':
    case 'superseded':
      return value;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBody(json: string): CardBody {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new AegisError('E_INTERNAL', 'Stored card body is invalid JSON');
  }
  if (!isRecord(value)
    || typeof value.kind !== 'string'
    || parseCardKind(value.kind) === null
    || !['ok', 'awaiting-input', 'invalid', 'degraded'].includes(String(value.status))
    || typeof value.synthetic !== 'boolean'
    || !(typeof value.syntheticLabel === 'string' || value.syntheticLabel === null)
    || (value.synthetic === true && value.syntheticLabel === null)
    || typeof value.summary !== 'string'
    || !Array.isArray(value.fields)
    || !Array.isArray(value.sections)
    || !Array.isArray(value.assumptions)
    || !Array.isArray(value.warnings)
    || !Array.isArray(value.missing)
    || !(value.result === null || isRecord(value.result))) {
    throw new AegisError('E_INTERNAL', 'Stored card body is missing required fields or has an invalid synthetic label');
  }
  return value as unknown as CardBody;
}

function parseEvidenceIds(json: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new AegisError('E_INTERNAL', 'Stored card evidence ids are invalid JSON');
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new AegisError('E_INTERNAL', 'Stored card evidence ids are invalid');
  }
  return value;
}

function fromRow(row: CardRevisionRow): CardRevision {
  const kind = parseCardKind(row.kind);
  const state = parseCardState(row.state);
  if (kind === null || state === null) {
    throw new AegisError('E_INTERNAL', 'Stored card metadata is invalid');
  }
  const body = parseBody(row.body_json);
  if (body.kind !== kind) throw new AegisError('E_INTERNAL', 'Stored card kind does not match its body');
  return {
    cardId: row.card_id,
    tenantId: row.tenant_id,
    kind,
    revision: row.revision,
    state,
    title: row.title,
    body,
    evidenceIds: parseEvidenceIds(row.evidence_ids_json),
    formulationRef: row.formulation_ref,
    workflowRunId: row.workflow_run_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function revisionRow(db: Db, tenantId: string, cardId: string, revision?: number): CardRevisionRow | undefined {
  if (revision === undefined) {
    return db.prepare(
      'SELECT c.card_id, c.tenant_id, c.kind, r.revision, r.state, r.title, r.body_json, r.evidence_ids_json, r.formulation_ref, r.workflow_run_id, r.created_at, r.created_by FROM cards c JOIN card_revisions r ON r.card_id = c.card_id WHERE c.tenant_id = ? AND c.card_id = ? ORDER BY r.revision DESC LIMIT 1',
    ).get(tenantId, cardId) as CardRevisionRow | undefined;
  }
  return db.prepare(
    'SELECT c.card_id, c.tenant_id, c.kind, r.revision, r.state, r.title, r.body_json, r.evidence_ids_json, r.formulation_ref, r.workflow_run_id, r.created_at, r.created_by FROM cards c JOIN card_revisions r ON r.card_id = c.card_id WHERE c.tenant_id = ? AND c.card_id = ? AND r.revision = ?',
  ).get(tenantId, cardId, revision) as CardRevisionRow | undefined;
}

export function createCardRevision(db: Db, p: NewCardRevision, ids: IdGen, nowIso: string): CardRevision {
  if (p.body.kind !== p.kind) throw new AegisError('E_VALIDATION', 'Card kind must match card body kind');
  const create = db.transaction(() => {
    const cardId = p.cardId ?? ids.next('CARD');
    let revision = 1;
    if (p.cardId === undefined) {
      db.prepare('INSERT INTO cards (card_id, tenant_id, kind, created_at) VALUES (?, ?, ?, ?)')
        .run(cardId, p.tenantId, p.kind, nowIso);
    } else {
      const existing = db.prepare('SELECT card_id FROM cards WHERE card_id = ? AND tenant_id = ?')
        .get(cardId, p.tenantId);
      if (!existing) throw new AegisError('E_NOT_FOUND');
      const latest = db.prepare('SELECT MAX(revision) AS revision FROM card_revisions WHERE card_id = ?')
        .get(cardId) as { revision: number | null };
      revision = (latest.revision ?? 0) + 1;
      if (latest.revision !== null) {
        db.prepare('UPDATE card_revisions SET state = ? WHERE card_id = ? AND revision = ?')
          .run('superseded', cardId, latest.revision);
      }
    }

    db.prepare(
      'INSERT INTO card_revisions (card_id, revision, state, title, body_json, evidence_ids_json, formulation_ref, workflow_run_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(cardId, revision, p.state, p.title, canonicalize(p.body), canonicalize(p.evidenceIds), p.formulationRef,
      p.workflowRunId, nowIso, p.createdBy);
    return getCardRevision(db, p.tenantId, cardId, revision);
  });
  const created = create.immediate();
  if (!created) throw new AegisError('E_INTERNAL', 'New card revision could not be read back');
  return created;
}

export function getCardRevision(db: Db, tenantId: string, cardId: string, revision?: number): CardRevision | null {
  const row = revisionRow(db, tenantId, cardId, revision);
  return row ? fromRow(row) : null;
}

export function listCardRevisions(db: Db, tenantId: string, cardId: string): CardRevisionSummary[] {
  const rows = db.prepare(
    'SELECT r.revision, r.state, r.created_at FROM card_revisions r JOIN cards c ON c.card_id = r.card_id WHERE c.tenant_id = ? AND c.card_id = ? ORDER BY r.revision',
  ).all(tenantId, cardId) as Array<{ revision: number; state: string; created_at: string }>;
  return rows.map((row) => {
    const state = parseCardState(row.state);
    if (state === null) throw new AegisError('E_INTERNAL', 'Stored card revision state is invalid');
    return { revision: row.revision, state, createdAt: row.created_at };
  });
}

export function listCards(db: Db, tenantId: string, kind?: CardKind): CardSummary[] {
  const rows = kind === undefined
    ? db.prepare(
      'SELECT c.card_id, c.tenant_id, c.kind, r.revision, r.state, r.title, r.created_at FROM cards c JOIN card_revisions r ON r.card_id = c.card_id WHERE c.tenant_id = ? AND r.revision = (SELECT MAX(latest.revision) FROM card_revisions latest WHERE latest.card_id = c.card_id) ORDER BY r.created_at DESC, c.card_id',
    ).all(tenantId) as CardSummaryRow[]
    : db.prepare(
      'SELECT c.card_id, c.tenant_id, c.kind, r.revision, r.state, r.title, r.created_at FROM cards c JOIN card_revisions r ON r.card_id = c.card_id WHERE c.tenant_id = ? AND c.kind = ? AND r.revision = (SELECT MAX(latest.revision) FROM card_revisions latest WHERE latest.card_id = c.card_id) ORDER BY r.created_at DESC, c.card_id',
    ).all(tenantId, kind) as CardSummaryRow[];
  return rows.map((row) => {
    const cardKind = parseCardKind(row.kind);
    const cardState = parseCardState(row.state);
    if (cardKind === null || cardState === null) {
      throw new AegisError('E_INTERNAL', 'Stored card summary metadata is invalid');
    }
    return {
      cardId: row.card_id,
      tenantId: row.tenant_id,
      kind: cardKind,
      revision: row.revision,
      state: cardState,
      title: row.title,
      createdAt: row.created_at,
    };
  });
}

function scopedRevisionExists(db: Db, tenantId: string, cardId: string, revision: number): boolean {
  return db.prepare(
    'SELECT 1 AS present FROM cards c JOIN card_revisions r ON r.card_id = c.card_id WHERE c.tenant_id = ? AND c.card_id = ? AND r.revision = ?',
  ).get(tenantId, cardId, revision) !== undefined;
}

function readLinks(db: Db, tenantId: string): CardLink[] {
  const rows = db.prepare(
    'SELECT l.parent_card_id, l.parent_revision, l.child_card_id, l.child_revision, l.relation FROM card_links l JOIN cards p ON p.card_id = l.parent_card_id JOIN cards c ON c.card_id = l.child_card_id WHERE p.tenant_id = ? AND c.tenant_id = ?',
  ).all(tenantId, tenantId) as LinkRow[];
  return rows.map((row) => ({
    parentCardId: row.parent_card_id,
    parentRevision: row.parent_revision,
    childCardId: row.child_card_id,
    childRevision: row.child_revision,
    relation: row.relation,
  }));
}

function longestPath(start: string, edges: Map<string, string[]>): number {
  const memo = new Map<string, number>();
  const visit = (node: string): number => {
    const cached = memo.get(node);
    if (cached !== undefined) return cached;
    const length = Math.max(0, ...(edges.get(node) ?? []).map((next) => 1 + visit(next)));
    memo.set(node, length);
    return length;
  };
  return visit(start);
}

function reaches(start: string, target: string, edges: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node === target) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    pending.push(...(edges.get(node) ?? []));
  }
  return false;
}

function adjacency(links: CardLink[], reverse = false): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const link of links) {
    const from = reverse ? link.childCardId : link.parentCardId;
    const to = reverse ? link.parentCardId : link.childCardId;
    edges.set(from, [...(edges.get(from) ?? []), to]);
  }
  return edges;
}

export function addLink(db: Db, tenantId: string, link: CardLink): void {
  const add = db.transaction(() => {
    if (!scopedRevisionExists(db, tenantId, link.parentCardId, link.parentRevision)
      || !scopedRevisionExists(db, tenantId, link.childCardId, link.childRevision)) {
      throw new AegisError('E_NOT_FOUND');
    }
    const links = readLinks(db, tenantId);
    const forward = adjacency(links);
    if (link.parentCardId === link.childCardId || reaches(link.childCardId, link.parentCardId, forward)) {
      throw new AegisError('E_CARD_CYCLE');
    }
    const downward = adjacency(links);
    const upward = adjacency(links, true);
    if (longestPath(link.parentCardId, upward) + 1 + longestPath(link.childCardId, downward) > MAX_CARD_DEPTH) {
      throw new AegisError('E_CARD_DEPTH');
    }
    db.prepare(
      'INSERT INTO card_links (parent_card_id, parent_revision, child_card_id, child_revision, relation) VALUES (?, ?, ?, ?, ?)',
    ).run(link.parentCardId, link.parentRevision, link.childCardId, link.childRevision, link.relation);
  });
  add.immediate();
}

export function getChildren(db: Db, tenantId: string, cardId: string, revision: number): CardLink[] {
  const rows = db.prepare(
    'SELECT l.parent_card_id, l.parent_revision, l.child_card_id, l.child_revision, l.relation FROM card_links l JOIN cards p ON p.card_id = l.parent_card_id JOIN cards c ON c.card_id = l.child_card_id WHERE p.tenant_id = ? AND c.tenant_id = ? AND l.parent_card_id = ? AND l.parent_revision = ? ORDER BY l.child_card_id, l.child_revision, l.relation',
  ).all(tenantId, tenantId, cardId, revision) as LinkRow[];
  return rows.map((row) => ({
    parentCardId: row.parent_card_id,
    parentRevision: row.parent_revision,
    childCardId: row.child_card_id,
    childRevision: row.child_revision,
    relation: row.relation,
  }));
}
