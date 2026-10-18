import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/api/server.js';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { listCards } from '../../src/data/repos/cards.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { incidentPeriodOf, withIncidentPeriod } from '../../src/services/incidentPeriod.js';
import { seedAll } from '../../src/services/seed.js';
import type { CardRevision, EvidenceView } from '../../src/types/domain.js';

const migrations = fileURLToPath(new URL('../../migrations/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

function harness(nowIso: string) {
  const db = openDb(':memory:');
  const ids = new SeqIdGen();
  migrate(db, migrations, '2026-10-13T00:00:00Z');
  seedAll(db, fixtures, new FixedClock('2026-10-13T00:00:00Z'), ids);
  const app = createApp({ db, clock: new FixedClock(nowIso), ids, config: loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' }) });
  apps.push(app);
  return { db, app };
}
async function token(app: FastifyInstance): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'USER-A-COORD' } });
  return (r.json() as { token: string }).token;
}
const period = (card: { body: { fields: { key: string; value: unknown }[] } }) => card.body.fields.find((f) => f.key === 'incidentPeriod')?.value;

describe('incidentPeriod is derived at read time from the cited evidence (AEG-HAZARD-001)', () => {
  it('pure rule: no evidence is unknown; stale or superseded evidence is historical; fresh evidence is current', () => {
    const v = (flags: string[]) => ({ evidenceId: 'E', flags } as unknown as EvidenceView);
    expect(incidentPeriodOf([])).toBeNull();
    expect(incidentPeriodOf([v([])])).toBe('current');
    expect(incidentPeriodOf([v(['STALE'])])).toBe('historical');
    expect(incidentPeriodOf([v(['SUPERSEDED'])])).toBe('historical');
    expect(incidentPeriodOf([v(['CONFLICTING'])])).toBe('current');
  });

  it('other card kinds and cards that already carry the field are returned unchanged', () => {
    const base = { kind: 'note', evidenceIds: ['E'], body: { fields: [] } } as unknown as CardRevision;
    expect(withIncidentPeriod(base, [])).toBe(base);
    const has = { kind: 'incident', evidenceIds: ['E'], body: { fields: [{ key: 'incidentPeriod', value: 'current' }] } } as unknown as CardRevision;
    expect(withIncidentPeriod(has, [{ evidenceId: 'E', flags: ['STALE'] } as unknown as EvidenceView])).toBe(has);
  });

  it('the API marks the seeded flood current and the old storm historical, and the stored card is not altered', async () => {
    const { db, app } = harness('2026-10-13T01:00:00Z');
    const auth = { authorization: `Bearer ${await token(app)}` };
    const list = (await app.inject({ method: 'GET', url: '/api/cards?kind=incident', headers: auth })).json() as { cards: { cardId: string; latestRevision: number; title: string }[] };
    expect(list.cards.length).toBe(4);
    const byTitle = async (needle: string) => {
      const c = list.cards.find((x) => x.title.toLowerCase().includes(needle))!;
      const r = await app.inject({ method: 'GET', url: `/api/cards/${c.cardId}?revision=${c.latestRevision}`, headers: auth });
      return (r.json() as { card: { body: { fields: { key: string; value: unknown }[] } } });
    };
    const flood = await byTitle('flood');
    expect(period(flood.card)).toBe('current');
    expect(period((await byTitle('storm')).card)).toBe('historical');
    // derived, never stored: the database rows have no incidentPeriod field
    const stored = listCards(db, 'TENANT-A', 'incident');
    expect(stored.length).toBe(4);
    const raw = db.prepare('SELECT body_json FROM card_revisions').all() as { body_json: string }[];
    expect(raw.some((row) => row.body_json.includes('incidentPeriod'))).toBe(false);
  });

  it('a card turns historical on its own once its evidence goes stale', async () => {
    const { app } = harness('2026-10-20T00:00:00Z');   // seeded flood is valid for 48 hours after publication
    const auth = { authorization: `Bearer ${await token(app)}` };
    const list = (await app.inject({ method: 'GET', url: '/api/cards?kind=incident', headers: auth })).json() as { cards: { cardId: string; latestRevision: number }[] };
    for (const c of list.cards) {
      const d = (await app.inject({ method: 'GET', url: `/api/cards/${c.cardId}?revision=${c.latestRevision}`, headers: auth })).json() as { card: { body: { fields: { key: string; value: unknown }[] } } };
      expect(period(d.card)).toBe('historical');
    }
  });
});
