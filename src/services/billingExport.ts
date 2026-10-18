// Google's real bill, read from the Cloud Billing export in BigQuery (AEG-ADMIN-001 / AEG-SOP-002 reconciliation). The Cloud Billing API key can read only the public price catalog, not what we were charged;
// the standard BigQuery billing export holds the charges and credits by service. This service runs ONE read-only query (parameterised, a few kilobytes scanned) and returns cost, credits and the net
// that reached the card, by service, for the current month. It never writes. Needs AEGIS_BILLING_EXPORT_TABLE (project.dataset.table). Authorised by the local gcloud login (AEGIS_BILLING_AUTH=gcloud,
// the owner's machine only) or, on Cloud Run, the service account (BigQuery Data Viewer on the dataset and BigQuery Job User). The export lags the console by a few hours.
import { execFile } from 'node:child_process';

export interface BillingRow { service: string; costUsd: number; creditsUsd: number; netUsd: number }
export interface BillingReport {
  available: true; month: string; rows: BillingRow[]; costUsd: number; creditsUsd: number; netUsd: number; firstUse: string | null; lastUse: string | null; fetchedAt: string; source: 'bigquery-billing-export'; note: string;
}
export interface BillingUnavailable { available: false; reason: string }
export interface BillingSource { report(refresh?: boolean): Promise<BillingReport | BillingUnavailable> }
export interface BillingSettings { table: string; auth: 'gcloud' | 'metadata'; now?: () => Date; fetchImpl?: typeof fetch; token?: () => Promise<string>; cacheMs?: number }

const TABLE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const METADATA_TOKEN = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const iso = (v: unknown): string | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null; };

function gcloudToken(): Promise<string> {
  return new Promise((resolve, reject) => execFile('gcloud', ['auth', 'print-access-token'], { shell: process.platform === 'win32', timeout: 20_000 }, (err, out) => (err ? reject(new Error('gcloud could not give an access token')) : resolve(String(out).trim()))));
}

export function createBillingSource(s: BillingSettings): BillingSource {
  if (!TABLE.test(s.table)) throw new Error('AEGIS_BILLING_EXPORT_TABLE must look like project.dataset.table');
  const fetchImpl = s.fetchImpl ?? fetch; const now = s.now ?? (() => new Date());
  const project = s.table.split('.')[0]!;
  const token = s.token ?? (s.auth === 'gcloud' ? gcloudToken : async () => ((await (await fetchImpl(METADATA_TOKEN, { headers: { 'Metadata-Flavor': 'Google' } })).json()) as { access_token: string }).access_token);
  let cached: { at: number; value: BillingReport } | null = null;
  return {
    async report(refresh = false) {
      if (!refresh && cached && now().getTime() - cached.at < (s.cacheMs ?? 600_000)) return cached.value;
      const monthStart = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), 1));
      try {
        const query = `SELECT service.description AS service, SUM(cost) AS cost, SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS credits, UNIX_SECONDS(MIN(usage_start_time)) AS first_use, UNIX_SECONDS(MAX(usage_end_time)) AS last_use FROM \`${s.table}\` WHERE usage_start_time >= @since GROUP BY service ORDER BY cost DESC`;
        const r = await fetchImpl(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries`, {
          method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', 'x-goog-user-project': project }, signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ query, useLegacySql: false, timeoutMs: 25_000, maxResults: 200, parameterMode: 'NAMED', queryParameters: [{ name: 'since', parameterType: { type: 'TIMESTAMP' }, parameterValue: { value: monthStart.toISOString() } }] }),
        });
        const body = await r.json() as { jobComplete?: boolean; rows?: { f: { v: unknown }[] }[]; error?: { message?: string } };
        if (!r.ok) return { available: false, reason: `BigQuery refused the query (HTTP ${r.status}): ${(body.error?.message ?? '').slice(0, 160)}` };
        if (body.jobComplete === false) return { available: false, reason: 'The billing query did not finish in time; try again.' };
        const rows: BillingRow[] = (body.rows ?? []).map((row) => { const f = row.f.map((c) => c.v); const cost = num(f[1]); const credits = num(f[2]); return { service: String(f[0]), costUsd: cost, creditsUsd: credits, netUsd: cost + credits }; });
        const firsts = (body.rows ?? []).map((row) => iso(row.f[3]!.v)).filter((x): x is string => x !== null).sort(); const lasts = (body.rows ?? []).map((row) => iso(row.f[4]!.v)).filter((x): x is string => x !== null).sort();
        const costUsd = rows.reduce((n, x) => n + x.costUsd, 0); const creditsUsd = rows.reduce((n, x) => n + x.creditsUsd, 0);
        const value: BillingReport = { available: true, month: monthStart.toISOString().slice(0, 7), rows, costUsd, creditsUsd, netUsd: costUsd + creditsUsd, firstUse: firsts[0] ?? null, lastUse: lasts[lasts.length - 1] ?? null, fetchedAt: now().toISOString(), source: 'bigquery-billing-export',
          note: 'From the Cloud Billing export in BigQuery, which lags the console by a few hours. Credits are negative amounts; net is what reached the card.' };
        cached = { at: now().getTime(), value };
        return value;
      } catch (error) { return { available: false, reason: error instanceof Error ? error.message.slice(0, 200) : 'The billing export could not be read.' }; }
    },
  };
}

export function billingFromEnv(env: NodeJS.ProcessEnv): BillingSource | null {
  const table = env['AEGIS_BILLING_EXPORT_TABLE']; if (!table) return null;
  return createBillingSource({ table, auth: env['AEGIS_BILLING_AUTH'] === 'gcloud' ? 'gcloud' : 'metadata' });
}
