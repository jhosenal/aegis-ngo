import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { AegisError } from '../../src/engine/errors.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import type { CardBody, CardLink, Principal } from '../../src/types/domain.js';
import { addLink, createCardRevision, getCardRevision, listCards } from '../../src/data/repos/cards.js';
import { listPins, pinCard, unpinCard } from '../../src/data/repos/pins.js';
import { resolveAttachments } from '../../src/services/cardService.js';

type Db = import('better-sqlite3').Database;
const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const databases: Db[] = [];
let ids = new SeqIdGen();

function makeDb(): Db {
  ids = new SeqIdGen();
  const db = openDb(':memory:');
  databases.push(db);
  migrate(db, migrationDirectory, '2026-10-13T01:00:00Z');
  db.prepare('INSERT INTO tenants (tenant_id, product_id, name) VALUES (?, ?, ?)').run('TENANT-A', 'AEG', 'Synthetic A');
  db.prepare('INSERT INTO tenants (tenant_id, product_id, name) VALUES (?, ?, ?)').run('TENANT-B', 'AEG', 'Synthetic B');
  db.prepare('INSERT INTO users (user_id, tenant_id, role, display_name) VALUES (?, ?, ?, ?)')
    .run('USER-A', 'TENANT-A', 'coordinator', 'Synthetic user A');
  db.prepare('INSERT INTO users (user_id, tenant_id, role, display_name) VALUES (?, ?, ?, ?)')
    .run('USER-B', 'TENANT-B', 'coordinator', 'Synthetic user B');
  return db;
}

function principal(tenantId: string): Principal {
  return {
    userId: tenantId === 'TENANT-A' ? 'USER-A' : 'USER-B',
    tenantId,
    productId: 'AEG',
    role: 'coordinator',
  };
}

function body(kind: CardBody['kind'] = 'note'): CardBody {
  return {
    kind,
    status: 'ok',
    synthetic: false,
    syntheticLabel: null,
    summary: 'Synthetic test card',
    fields: [],
    sections: [],
    assumptions: [],
    warnings: [],
    missing: [],
    result: null,
  };
}

function createRevision(db: Db, tenantId = 'TENANT-A', cardId?: string) {
  return createCardRevision(db, {
    tenantId,
    ...(cardId === undefined ? {} : { cardId }),
    kind: 'note',
    title: 'Synthetic test card',
    body: body(),
    evidenceIds: [],
    formulationRef: null,
    workflowRunId: null,
    createdBy: tenantId === 'TENANT-A' ? 'USER-A' : 'USER-B',
    state: 'draft',
  }, ids, '2026-10-13T01:00:00Z');
}

function create(db: Db, tenantId = 'TENANT-A', cardId?: string): string {
  return createRevision(db, tenantId, cardId).cardId;
}

function link(parentCardId: string, childCardId: string): CardLink {
  return { parentCardId, parentRevision: 1, childCardId, childRevision: 1, relation: 'input' };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('card repositories and service', () => {
  it('AEG-TST-006 numbers revisions and supersedes the previous revision', () => {
    const db = makeDb();
    const first = createRevision(db);
    const cardId = first.cardId;
    const second = createRevision(db, 'TENANT-A', cardId);
    expect(second.revision).toBe(2);
    expect(second.state).toBe('draft');
    expect(getCardRevision(db, 'TENANT-A', cardId, 1)?.state).toBe('superseded');
  });

  it('AEG-TST-006 returns not found across tenants for get, pin and attachments', () => {
    const db = makeDb();
    const foreignCardId = create(db, 'TENANT-B');
    expect(getCardRevision(db, 'TENANT-A', foreignCardId)).toBeNull();
    expect(() => pinCard(db, principal('TENANT-A'), foreignCardId, '2026-10-13T01:00:00Z'))
      .toThrowError(expect.objectContaining({ code: 'E_NOT_FOUND' }));
    expect(() => resolveAttachments(db, principal('TENANT-A'), [{ cardId: foreignCardId, revision: 1 }]))
      .toThrowError(expect.objectContaining({ code: 'E_NOT_FOUND' }));
  });

  it('AEG-TST-006 pins idempotently without changing the first pinned time', () => {
    const db = makeDb();
    const cardId = create(db);
    const user = principal('TENANT-A');
    pinCard(db, user, cardId, '2026-10-13T01:00:00Z');
    pinCard(db, user, cardId, '2026-10-13T02:00:00Z');
    expect(listPins(db, user)).toEqual([{ cardId, pinnedAt: '2026-10-13T01:00:00Z' }]);
  });

  it('AEG-TST-006 unpins a card from the principal workspace', () => {
    const db = makeDb();
    const cardId = create(db);
    const user = principal('TENANT-A');
    pinCard(db, user, cardId, '2026-10-13T01:00:00Z');
    unpinCard(db, user, cardId);
    expect(listPins(db, user)).toEqual([]);
  });

  it('AEG-TST-006 returns the exact attached revision when a newer revision exists', () => {
    const db = makeDb();
    const cardId = create(db);
    create(db, 'TENANT-A', cardId);
    const attached = resolveAttachments(db, principal('TENANT-A'), [{ cardId, revision: 1 }]);
    expect(attached).toHaveLength(1);
    expect(attached[0]?.revision).toBe(1);
    expect(attached[0]?.state).toBe('superseded');
  });

  it('AEG-TST-006 rejects six attachments at the service boundary', () => {
    const db = makeDb();
    const refs = Array.from({ length: 6 }, (_, index) => ({ cardId: `MISSING-${index}`, revision: 1 }));
    expect(() => resolveAttachments(db, principal('TENANT-A'), refs))
      .toThrowError(expect.objectContaining({ code: 'E_VALIDATION' }));
  });

  it('AEG-TST-006 rejects a self link as a cycle', () => {
    const db = makeDb();
    const cardId = create(db);
    expect(() => addLink(db, 'TENANT-A', link(cardId, cardId)))
      .toThrowError(expect.objectContaining({ code: 'E_CARD_CYCLE' }));
  });

  it('AEG-TST-006 rejects a cycle of length three', () => {
    const db = makeDb();
    const a = create(db);
    const b = create(db);
    const c = create(db);
    addLink(db, 'TENANT-A', link(a, b));
    addLink(db, 'TENANT-A', link(b, c));
    expect(() => addLink(db, 'TENANT-A', link(c, a)))
      .toThrowError(expect.objectContaining({ code: 'E_CARD_CYCLE' }));
  });

  it('AEG-TST-006 allows a path of six links and rejects a path of seven', () => {
    const db = makeDb();
    const cards = Array.from({ length: 8 }, () => create(db));
    for (let index = 0; index < 6; index += 1) addLink(db, 'TENANT-A', link(cards[index]!, cards[index + 1]!));
    expect(() => addLink(db, 'TENANT-A', link(cards[6]!, cards[7]!)))
      .toThrowError(expect.objectContaining({ code: 'E_CARD_DEPTH' }));
  });

  it('AEG-TST-006 rejects a synthetic card body without its label on read', () => {
    const db = makeDb();
    const cardId = create(db);
    const malformed = { ...body(), synthetic: true, syntheticLabel: null };
    db.prepare('UPDATE card_revisions SET body_json = ? WHERE card_id = ? AND revision = ?')
      .run(JSON.stringify(malformed), cardId, 1);
    expect(() => getCardRevision(db, 'TENANT-A', cardId)).toThrowError(expect.objectContaining({ code: 'E_INTERNAL' }));
  });

  it('AEG-TST-006 lists only the tenant cards and supports kind filtering', () => {
    const db = makeDb();
    const tenantCard = create(db, 'TENANT-A');
    create(db, 'TENANT-B');
    const cards = listCards(db, 'TENANT-A');
    expect(cards.map((card) => card.cardId)).toEqual([tenantCard]);
    expect(listCards(db, 'TENANT-A', 'assessment')).toEqual([]);
  });
});
