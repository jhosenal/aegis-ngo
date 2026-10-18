import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent } from '../audit/chainStore.js';
import type { Db } from '../data/db.js';
import { findLatestEvidence, getSourceStatus, listEvidence } from '../data/repos/evidence.js';
import { AegisError } from '../engine/errors.js';
import type { Clock } from '../engine/clock.js';
import type { IdGen } from '../engine/ids.js';
import type { Role } from '../types/domain.js';
import { hashWithDomain } from '../engine/canonical.js';
import { applyPoll, type FixturePoll, type SourceDef } from '../sources/fixtureAdapter.js';
import type { RawIncidentRecord } from '../sources/normalize.js';
import { projectIncidentCards } from './incidentCards.js';
import { seedFormulations } from '../registry/formulations.js';

interface TenantFixture {
  tenantId: string;
  productId: string;
  name: string;
}

interface UserFixture {
  userId: string;
  tenantId: string;
  role: Role;
  displayName: string;
}

interface ResourceFixture {
  resourceId: string;
  tenantId: string;
  regionId: string;
  unitId: string;
  availableUnits: number;
  reserveUnits: number;
  asOf: string;
  synthetic: boolean;
  label: string;
}

export interface SeedSummary {
  polls: ReturnType<typeof applyPoll>[];
  evidenceCount: number;
  createdIncidentCards: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new AegisError('E_INTERNAL', `Fixture field ${key} must be a string`);
  return value;
}

function requiredSafeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new AegisError('E_INTERNAL', `Fixture field ${key} must be a safe integer`);
  return value;
}

function readJson(fixturesDir: string, name: string): unknown {
  try {
    return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'invalid JSON';
    throw new AegisError('E_INTERNAL', `Unable to read fixture ${name}: ${message}`);
  }
}

function parseTenants(value: unknown): { tenants: TenantFixture[]; users: UserFixture[] } {
  if (!isRecord(value) || !Array.isArray(value.tenants) || !Array.isArray(value.users)) {
    throw new AegisError('E_INTERNAL', 'Invalid tenants fixture');
  }
  const tenants = value.tenants.map((entry): TenantFixture => {
    if (!isRecord(entry)) throw new AegisError('E_INTERNAL', 'Invalid tenant fixture row');
    return { tenantId: requiredString(entry, 'tenantId'), productId: requiredString(entry, 'productId'), name: requiredString(entry, 'name') };
  });
  const users = value.users.map((entry): UserFixture => {
    if (!isRecord(entry)) throw new AegisError('E_INTERNAL', 'Invalid user fixture row');
    const role = requiredString(entry, 'role');
    if (role !== 'coordinator' && role !== 'analyst' && role !== 'viewer') throw new AegisError('E_INTERNAL', 'Invalid fixture user role');
    return { userId: requiredString(entry, 'userId'), tenantId: requiredString(entry, 'tenantId'), role, displayName: requiredString(entry, 'displayName') };
  });
  return { tenants, users };
}

function parseResources(value: unknown): ResourceFixture[] {
  if (!isRecord(value) || !Array.isArray(value.resources)) throw new AegisError('E_INTERNAL', 'Invalid resources fixture');
  return value.resources.map((entry): ResourceFixture => {
    if (!isRecord(entry) || typeof entry.synthetic !== 'boolean') throw new AegisError('E_INTERNAL', 'Invalid resource fixture row');
    return {
      resourceId: requiredString(entry, 'resourceId'),
      tenantId: requiredString(entry, 'tenantId'),
      regionId: requiredString(entry, 'regionId'),
      unitId: requiredString(entry, 'unitId'),
      availableUnits: requiredSafeInteger(entry, 'availableUnits'),
      reserveUnits: requiredSafeInteger(entry, 'reserveUnits'),
      asOf: requiredString(entry, 'asOf'),
      synthetic: entry.synthetic,
      label: requiredString(entry, 'label'),
    };
  });
}

function parseSources(value: unknown): SourceDef[] {
  if (!isRecord(value) || !Array.isArray(value.sources)) throw new AegisError('E_INTERNAL', 'Invalid sources fixture');
  return value.sources.map((entry): SourceDef => {
    if (!isRecord(entry)) throw new AegisError('E_INTERNAL', 'Invalid source fixture row');
    return {
      sourceId: requiredString(entry, 'sourceId'),
      title: requiredString(entry, 'title'),
      licenceRef: requiredString(entry, 'licenceRef'),
      validHours: requiredSafeInteger(entry, 'validHours'),
      adapterVersion: requiredString(entry, 'adapterVersion'),
    };
  });
}

function parseRawIncident(value: unknown): RawIncidentRecord {
  if (!isRecord(value)) throw new AegisError('E_INTERNAL', 'Invalid raw incident fixture row');
  return {
    sourceRecordId: requiredString(value, 'sourceRecordId'),
    incidentKey: requiredString(value, 'incidentKey'),
    title: requiredString(value, 'title'),
    hazardType: requiredString(value, 'hazardType'),
    alertLevel: requiredString(value, 'alertLevel'),
    eventTime: requiredString(value, 'eventTime'),
    publishedAt: requiredString(value, 'publishedAt'),
    regionId: requiredString(value, 'regionId'),
    lat: requiredString(value, 'lat'),
    lon: requiredString(value, 'lon'),
    affectedPeopleEstimate: requiredSafeInteger(value, 'affectedPeopleEstimate'),
    sourceUrl: requiredString(value, 'sourceUrl'),
  };
}

function parsePolls(value: unknown): FixturePoll[] {
  if (!isRecord(value) || !Array.isArray(value.polls)) throw new AegisError('E_INTERNAL', 'Invalid feed polls fixture');
  return value.polls.map((entry): FixturePoll => {
    if (!isRecord(entry) || !Array.isArray(entry.records)) throw new AegisError('E_INTERNAL', 'Invalid fixture poll row');
    const outcome = requiredString(entry, 'outcome');
    if (outcome !== 'OK' && outcome !== 'UNAVAILABLE' && outcome !== 'MALFORMED') throw new AegisError('E_INTERNAL', 'Invalid fixture poll outcome');
    const detail = entry.detail === undefined ? undefined : requiredString(entry, 'detail');
    const rawText = entry.rawText === undefined ? undefined : requiredString(entry, 'rawText');
    return {
      pollId: requiredString(entry, 'pollId'),
      sourceId: requiredString(entry, 'sourceId'),
      fetchedAt: requiredString(entry, 'fetchedAt'),
      outcome,
      records: entry.records.map(parseRawIncident),
      ...(detail === undefined ? {} : { detail }),
      ...(rawText === undefined ? {} : { rawText }),
    };
  });
}

function parseFixedNow(value: unknown): string {
  if (!isRecord(value) || typeof value.fixedNow !== 'string' || !value.fixedNow.endsWith('Z') || !Number.isFinite(Date.parse(value.fixedNow))) {
    throw new AegisError('E_INTERNAL', 'Invalid clock fixture');
  }
  return value.fixedNow;
}

function fixtureAlreadyApplied(db: Db, polls: FixturePoll[], sources: SourceDef[]): boolean {
  const latestRecords = new Map<string, RawIncidentRecord>();
  const lastPollBySource = new Map<string, FixturePoll>();
  for (const poll of polls) {
    lastPollBySource.set(poll.sourceId, poll);
    if (poll.outcome === 'OK') {
      for (const raw of poll.records) latestRecords.set(`${poll.sourceId}\u0000${raw.sourceRecordId}`, raw);
    }
  }
  for (const [key, raw] of latestRecords) {
    const separator = key.indexOf('\u0000');
    const sourceId = key.slice(0, separator);
    const latest = findLatestEvidence(db, sourceId, raw.sourceRecordId);
    if (!latest || latest.rawArtifactHash !== hashWithDomain('AEG-EVIDENCE-v1', raw)) return false;
  }
  for (const source of sources) {
    const lastPoll = lastPollBySource.get(source.sourceId);
    if (!lastPoll) continue;
    const status = getSourceStatus(db, source.sourceId);
    if (!status || status.state !== lastPoll.outcome || status.lastAttemptAt !== lastPoll.fetchedAt) return false;
    const expectedLastOk = [...polls].reverse().find((poll) => poll.sourceId === source.sourceId && poll.outcome === 'OK')?.fetchedAt ?? null;
    if (status.lastOkAt !== expectedLastOk) return false;
    const expectedDetail = lastPoll.outcome === 'OK' ? null : lastPoll.detail ?? null;
    if (status.detail !== expectedDetail) return false;
  }
  return latestRecords.size > 0;
}

export function seedAll(db: Db, fixturesDir: string, clock: Clock, ids: IdGen): SeedSummary {
  const tenantData = parseTenants(readJson(fixturesDir, 'tenants.json'));
  const resources = parseResources(readJson(fixturesDir, 'resources.json'));
  const sources = parseSources(readJson(fixturesDir, 'sources.json'));
  const polls = parsePolls(readJson(fixturesDir, 'feed-polls.json'));
  const fixtureNow = parseFixedNow(readJson(fixturesDir, 'clock.json'));
  const nowIso = clock.now();
  if (Date.parse(nowIso) !== Date.parse(fixtureNow)) throw new AegisError('E_INTERNAL', 'Seed clock must match fixtures/clock.json');

  const seedBaseRows = db.transaction(() => {
    const insertTenant = db.prepare('INSERT OR IGNORE INTO tenants (tenant_id, product_id, name) VALUES (?, ?, ?)');
    for (const tenant of tenantData.tenants) insertTenant.run(tenant.tenantId, tenant.productId, tenant.name);

    const insertUser = db.prepare('INSERT OR IGNORE INTO users (user_id, tenant_id, role, display_name) VALUES (?, ?, ?, ?)');
    for (const user of tenantData.users) insertUser.run(user.userId, user.tenantId, user.role, user.displayName);

    const insertResource = db.prepare(
      'INSERT OR IGNORE INTO resources (resource_id, tenant_id, region_id, unit_id, available_units, reserve_units, as_of, synthetic, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const resource of resources) {
      insertResource.run(resource.resourceId, resource.tenantId, resource.regionId, resource.unitId, resource.availableUnits,
        resource.reserveUnits, resource.asOf, resource.synthetic ? 1 : 0, resource.label);
    }
  });
  seedBaseRows.immediate();

  seedFormulations(db, nowIso);
  const pollResults = fixtureAlreadyApplied(db, polls, sources)
    ? []
    : polls.map((poll) => applyPoll(db, poll, sources, ids));
  const projection = projectIncidentCards(db, ids, nowIso);
  return { polls: pollResults, evidenceCount: listEvidence(db).length, createdIncidentCards: projection.created };
}

export function fixedNowFromFixture(fixturesDir: string): string {
  return parseFixedNow(readJson(fixturesDir, 'clock.json'));
}
