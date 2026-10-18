// Polls the NEA PSI through the guarded fetch and stores each new published reading (AEG-PSI-001). A failed or malformed poll changes only the source status.
import type { Db } from '../data/db.js';
import { insertPsi } from '../data/repos/airReadings.js';
import { upsertSourceStatus } from '../data/repos/evidence.js';
import type { Clock } from '../engine/clock.js';
import { parsePsi, PSI_SOURCE_ID, PSI_URL } from '../sources/psi.js';
import { safeFetch, type FetchPolicy, type Resolver } from '../sources/safeFetch.js';
import type { SourceState } from '../types/domain.js';
import { dnsResolver } from './liveIngest.js';

const POLICY: FetchPolicy = { allowlist: ['api-open.data.gov.sg'], maxBytes: 2_000_000, timeoutMs: 30_000, maxRedirects: 2 };
export interface PsiIngestResult { outcome: SourceState; stored: boolean; observedAt: string | null; detail: string | null }

export async function runPsiIngest(deps: { db: Db; clock: Clock; fetchImpl?: typeof fetch; resolver?: Resolver }): Promise<PsiIngestResult> {
  const now = deps.clock.now();
  const previous = deps.db.prepare('SELECT last_ok_at FROM source_status WHERE source_id = ?').get(PSI_SOURCE_ID) as { last_ok_at: string | null } | undefined;
  const fail = (outcome: SourceState, detail: string): PsiIngestResult => {
    upsertSourceStatus(deps.db, { sourceId: PSI_SOURCE_ID, state: outcome, lastOkAt: previous?.last_ok_at ?? null, lastAttemptAt: now, detail });
    return { outcome, stored: false, observedAt: null, detail };
  };
  try {
    const res = await safeFetch(PSI_URL, POLICY, { resolver: deps.resolver ?? dnsResolver, fetchImpl: deps.fetchImpl ?? fetch });
    if (res.status !== 200) return fail('UNAVAILABLE', `HTTP ${res.status}`);
    let reading;
    try { reading = parsePsi(JSON.parse(res.text)); } catch (error) { return fail('MALFORMED', (error instanceof Error ? error.message : 'unreadable').slice(0, 160)); }
    const stored = insertPsi(deps.db, PSI_SOURCE_ID, reading, now);
    upsertSourceStatus(deps.db, { sourceId: PSI_SOURCE_ID, state: 'OK', lastOkAt: now, lastAttemptAt: now, detail: null });
    return { outcome: 'OK', stored, observedAt: reading.observedAt, detail: null };
  } catch (error) {
    return fail('UNAVAILABLE', (error instanceof Error ? error.message : String(error)).slice(0, 160));
  }
}
