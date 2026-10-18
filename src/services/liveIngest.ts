// Live ingestion (AEG-LIVE-001): polls the public USGS and GDACS feeds through the guarded fetch, normalises what names an ASEAN country or sea, and
// writes it as PUBLIC evidence (tenant_scope NULL, synthetic false) through the same intake the demo fixtures use. Cards are then projected for every
// tenant. A failed or malformed poll changes only the source status; it never removes evidence. Nothing here makes a paid call.
import { lookup } from 'node:dns/promises';
import type { Db } from '../data/db.js';
import type { Clock } from '../engine/clock.js';
import type { IdGen } from '../engine/ids.js';
import { applyPoll, type FixturePoll } from '../sources/fixtureAdapter.js';
import {
  GDACS_PAGE_SIZE, GDACS_SOURCE_ID, GDACS_TYPES, LIVE_SOURCES, USGS_FEED_URL, USGS_SOURCE_ID, gdacsUrl, mapGdacs, mapUsgs,
} from '../sources/liveFeeds.js';
import type { RawIncidentRecord } from '../sources/normalize.js';
import { safeFetch, type FetchPolicy, type Resolver } from '../sources/safeFetch.js';
import type { SourceState } from '../types/domain.js';
import { projectIncidentCards } from './incidentCards.js';

export const dnsResolver: Resolver = {
  async resolve(host: string): Promise<string[]> {
    return (await lookup(host, { all: true })).map((entry) => entry.address);
  },
};

export interface LiveIngestDeps {
  db: Db;
  ids: IdGen;
  clock: Clock;
  fetchImpl?: typeof fetch;
  resolver?: Resolver;
}

export interface SourceResult { outcome: SourceState; fetched: number; kept: number; inserted: number; duplicates: number; superseded: number; detail: string | null }
export interface LiveIngestResult { at: string; usgs: SourceResult; gdacs: SourceResult; cardsCreated: number }

const POLICY: FetchPolicy = { allowlist: ['earthquake.usgs.gov', 'www.gdacs.org'], maxBytes: 12_000_000, timeoutMs: 45_000, maxRedirects: 3 };
const empty = (outcome: SourceState, detail: string | null): SourceResult => ({ outcome, fetched: 0, kept: 0, inserted: 0, duplicates: 0, superseded: 0, detail });

function record(db: Db, ids: IdGen, sourceId: string, now: string, outcome: SourceState, records: RawIncidentRecord[], fetched: number, detail: string | null): SourceResult {
  const poll: FixturePoll = { pollId: `LIVE-${sourceId}-${now}`, sourceId, fetchedAt: now, outcome, records, ...(detail === null ? {} : { detail }) };
  const applied = applyPoll(db, poll, LIVE_SOURCES, ids);
  return { outcome, fetched, kept: records.length, inserted: applied.inserted.length, duplicates: applied.duplicates.length, superseded: applied.superseded.length, detail };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160);

export async function runLiveIngest(deps: LiveIngestDeps): Promise<LiveIngestResult> {
  const now = deps.clock.now();
  const fetchDeps = { resolver: deps.resolver ?? dnsResolver, fetchImpl: deps.fetchImpl ?? fetch };

  let usgsRecords: RawIncidentRecord[] = [];
  let usgs: SourceResult;
  try {
    const res = await safeFetch(USGS_FEED_URL, POLICY, fetchDeps);
    if (res.status !== 200) usgs = record(deps.db, deps.ids, USGS_SOURCE_ID, now, 'UNAVAILABLE', [], 0, `HTTP ${res.status}`);
    else {
      let parsed: unknown;
      try { parsed = JSON.parse(res.text); } catch { parsed = null; }
      let total = 0;
      try {
        usgsRecords = mapUsgs(parsed);
        total = (parsed as { features: unknown[] }).features.length;
        usgs = record(deps.db, deps.ids, USGS_SOURCE_ID, now, 'OK', usgsRecords, total, null);
      } catch (error: unknown) {
        usgs = record(deps.db, deps.ids, USGS_SOURCE_ID, now, 'MALFORMED', [], 0, message(error));
      }
    }
  } catch (error: unknown) {
    usgs = record(deps.db, deps.ids, USGS_SOURCE_ID, now, 'UNAVAILABLE', [], 0, message(error));
  }

  // GDACS: the last 14 days, one query per hazard type, paged (GDACS caps a page at 100 events); 204 means no events.
  const dayMs = 86_400_000;
  const toDate = now.slice(0, 10);
  const fromDate = new Date(Date.parse(now) - 14 * dayMs).toISOString().slice(0, 10);
  const features: unknown[] = [];
  const failed: string[] = [];
  let anyOk = false;
  for (const type of GDACS_TYPES) {
    try {
      for (let page = 1; page <= 10; page += 1) {
        const res = await safeFetch(gdacsUrl(type, fromDate, toDate, page), POLICY, fetchDeps);
        if (res.status === 204) { anyOk = true; break; }
        if (res.status !== 200) { failed.push(`${type}:HTTP ${res.status}`); break; }
        const body = JSON.parse(res.text) as { features?: unknown[] };
        if (!Array.isArray(body.features)) { failed.push(`${type}:malformed`); break; }
        anyOk = true;
        features.push(...body.features);
        if (body.features.length < GDACS_PAGE_SIZE) break;
      }
    } catch (error: unknown) {
      failed.push(`${type}:${message(error)}`);
    }
  }
  const detail = failed.length > 0 ? `partial: ${failed.join('; ')}`.slice(0, 300) : null;
  const gdacs = anyOk
    ? record(deps.db, deps.ids, GDACS_SOURCE_ID, now, 'OK', mapGdacs(features, usgsRecords), features.length, detail)
    : record(deps.db, deps.ids, GDACS_SOURCE_ID, now, 'UNAVAILABLE', [], 0, detail ?? 'no response');

  const projected = projectIncidentCards(deps.db, deps.ids, now);
  return { at: now, usgs, gdacs, cardsCreated: projected.created.length };
}
