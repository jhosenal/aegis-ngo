import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from './api/client.js';

export interface JobLine { item: string; quantity: string; unit: string; usd: string }
export interface Job {
  jobId: string; kind: 'draft' | 'translate' | 'voice' | 'render' | 'review'; bulletinId: string | null; language: string | null; label: string; createdBy: string; createdAt: string; finishedAt: string | null;
  status: 'ESTIMATED' | 'DONE' | 'FAILED' | 'WAITING_OWNER' | 'CANCELLED'; estimateStatus: 'ESTIMATE' | 'UNKNOWN'; estimateUsd: string | null; settledUsd: string | null; lines: JobLine[]; params: Record<string, unknown>; note: string | null; priceBookVersion: string | null;
}
export interface Wallet { balanceUsd: string | null; openingUsd: string | null; topupUsd: string | null; reservedUsd: string | null; spentUsd: string | null; note: string }
const JOB_PAGE = 20;
interface JobsReply { wallet: Wallet; scope: 'all' | 'own'; totalUsd: string; unknown: number; jobs: Job[] }

const usd = (v: string | null, digits = 4): string => (v === null ? 'UNKNOWN' : `${Number(v).toFixed(digits)} USD`);
const when = (iso: string): string => iso.replace('T', ' ').slice(0, 19) + ' UTC';
const STATUS: Record<Job['status'], { text: string; tone: 'ok' | 'warn' | 'off' }> = { DONE: { text: 'Done', tone: 'ok' }, ESTIMATED: { text: 'Running', tone: 'warn' }, WAITING_OWNER: { text: 'Waiting for the owner', tone: 'off' }, FAILED: { text: 'Failed', tone: 'off' }, CANCELLED: { text: 'Cancelled', tone: 'off' } };
const KIND: Record<Job['kind'], string> = { draft: 'DRAFT', translate: 'TRANSLATE', voice: 'VOICE', render: 'RENDER', review: 'REVIEW' };

/** The credit balance of the jobs: opening, top-ups, reserved by running jobs, spent by finished ones, and what is left. */
export function WalletBar({ wallet, onTopUp }: { wallet: Wallet; onTopUp?: () => void }) {
  return <div className="job-wallet" role="group" aria-label="Job credit">
    <div className="job-wallet-main"><span className="eyebrow">JOB CREDIT BALANCE</span><strong data-testid="job-balance">{usd(wallet.balanceUsd, 4)}</strong><small>available now</small></div>
    <dl><div><dt>Opening</dt><dd>{usd(wallet.openingUsd, 2)}</dd></div><div><dt>Top-ups</dt><dd>{usd(wallet.topupUsd, 2)}</dd></div><div><dt>Reserved</dt><dd>{usd(wallet.reservedUsd, 4)}</dd></div><div><dt>Spent</dt><dd>{usd(wallet.spentUsd, 4)}</dd></div></dl>
    {onTopUp && <button type="button" onClick={onTopUp}>Top up</button>}
  </div>;
}

/** One job as a card: its UUID (the job sheet number, for audit), what it is, who asked, the priced lines, the estimate and the settled cost. */
export function JobCard({ job }: { job: Job }) {
  const st = STATUS[job.status];
  return <article className="job-card" aria-label={`Job ${job.jobId}`} data-job-id={job.jobId}>
    <header><span className="job-kind">{KIND[job.kind]}</span><span className={`admin-badge admin-${st.tone}`}>{st.text}</span>{job.estimateStatus === 'UNKNOWN' && <span className="admin-badge admin-off">Cost UNKNOWN</span>}</header>
    <strong>{job.label}</strong>
    <code className="job-uuid" title="Job sheet UUID">{job.jobId}</code>
    <div className="job-money"><span>Estimate <b>{usd(job.estimateUsd)}</b></span><span>Settled <b>{job.settledUsd === null ? 'not yet' : usd(job.settledUsd)}</b></span></div>
    <small>{job.bulletinId ? `Bulletin ${job.bulletinId}` : 'No bulletin'}{job.language ? ` · ${job.language}` : ''} · by {job.createdBy} · {when(job.createdAt)}</small>
    {job.note && <small>{job.note}</small>}
    {job.lines.length > 0 && <details><summary>What was priced ({job.lines.length})</summary><ul className="admin-list">{job.lines.map((l, i) => <li key={i}>{l.item}: {l.quantity} {l.unit} = {l.usd} USD</li>)}<li><small>Price book {job.priceBookVersion ?? 'not on this server'}</small></li></ul></details>}
  </article>;
}

/** The job cards and the credit, in the Governance and costs tab. Administrators see every card and can top up; the credit never blocks an alert, it gates presenter renders. */
export function JobCards({ token, bulletinId, canTopUp = true }: { token: string; bulletinId?: string; canTopUp?: boolean }) {
  const [data, setData] = useState<JobsReply | null>(null);
  const [kind, setKind] = useState('');
  const [error, setError] = useState('');
  const [topping, setTopping] = useState(false);
  const [showAll, setShowAll] = useState(false);   // the list can be long; the latest 20 are shown first
  const [amount, setAmount] = useState('1'); const [reason, setReason] = useState('');
  const load = useCallback((): void => {
    const q = new URLSearchParams(); if (bulletinId) q.set('bulletinId', bulletinId); if (kind) q.set('kind', kind);
    apiRequest<JobsReply>(`/api/jobs?${q.toString()}`, { token }).then((r) => { setData(r); setError(''); }).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The job cards could not be loaded.'));
  }, [token, bulletinId, kind]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  const topUp = (): void => {
    apiRequest('/api/admin/credit/topup', { token, method: 'POST', body: { amountUsd: Number(amount), note: reason } }).then(() => { setTopping(false); setReason(''); load(); }).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The top-up failed.'));
  };
  const download = (): void => {
    const q = bulletinId ? `?bulletinId=${encodeURIComponent(bulletinId)}` : '';
    fetch(`/api/jobs-export${q}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.blob()).then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'aegis-job-sheets.json'; a.click(); URL.revokeObjectURL(a.href); }).catch(() => setError('The export failed.'));
  };
  if (!data) return <p role={error ? 'alert' : 'status'}>{error || 'Loading the job cards…'}</p>;
  return <section className="job-cards" aria-label="Job cards" data-testid="job-cards">
    <WalletBar wallet={data.wallet} {...(canTopUp && data.scope === 'all' ? { onTopUp: () => setTopping((v) => !v) } : {})}/>
    {topping && <p className="job-topup"><label>Amount (USD) <input type="number" min="0.01" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 80 }}/></label>{' '}
      <label>Reason <input type="text" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="why (at least 5 characters)" style={{ minWidth: 240 }}/></label>{' '}
      <button type="button" disabled={reason.trim().length < 5 || !(Number(amount) > 0)} onClick={topUp}>Add to the credit</button></p>}
    <p className="job-toolbar"><strong>{data.jobs.length} job card{data.jobs.length === 1 ? '' : 's'}{!showAll && data.jobs.length > JOB_PAGE ? ` (latest ${JOB_PAGE} shown)` : ''}</strong> · total {usd(data.totalUsd)}{data.unknown > 0 ? ` · ${data.unknown} with an UNKNOWN cost` : ''}{data.scope === 'own' ? ' · your own jobs' : ''}{' '}
      <label>Kind <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All</option><option value="draft">Draft</option><option value="translate">Translate</option><option value="voice">Voice</option><option value="render">Render</option><option value="review">Review</option></select></label>{' '}
      <button type="button" onClick={download}>Download JSON (audit)</button></p>
    <small>{data.wallet.note} Estimates come from the price book and are ceilings; a settled cost uses the real numbers; neither is Google's invoice.</small>
    {error && <p role="alert">{error}</p>}
    <div className="job-grid">{(showAll ? data.jobs : data.jobs.slice(0, JOB_PAGE)).map((j) => <JobCard key={j.jobId} job={j}/>)}</div>
    {data.jobs.length > JOB_PAGE && <p><button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>{showAll ? `Show the latest ${JOB_PAGE} only` : `Show all ${data.jobs.length} job cards`}</button></p>}
    {data.jobs.length === 0 && <p>No jobs yet. A translation, a voice or a render creates a card.</p>}
  </section>;
}

interface BillingRow { service: string; costUsd: number; creditsUsd: number; netUsd: number }
interface BillingReply { report: { available: true; month: string; rows: BillingRow[]; costUsd: number; creditsUsd: number; netUsd: number; firstUse: string | null; lastUse: string | null; fetchedAt: string; note: string } | { available: false; reason: string }; jobCards: { count: number; usd: string | null; note: string } }
const money = (n: number, d = 2): string => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(d)} USD`;

/** Google's real bill for the month from the BigQuery billing export, beside what our own estimates said: the reconciliation. Read-only. */
export function BillingCard({ token, engineCommittedUsd }: { token: string; engineCommittedUsd?: string | null }) {
  const [data, setData] = useState<BillingReply | null>(null);
  const [error, setError] = useState('');
  const load = useCallback((refresh = false): void => {
    apiRequest<BillingReply>(`/api/admin/billing${refresh ? '?refresh=1' : ''}`, { token }).then((r) => { setData(r); setError(''); }).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The billing view could not be loaded.'));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <p role={error ? 'alert' : 'status'}>{error || 'Reading the Google bill…'}</p>;
  const r = data.report;
  if (!r.available) return <section aria-label="Google bill" data-testid="billing-card"><p><strong>Google bill not connected.</strong> {r.reason}</p><small>Without it, costs shown here are estimates only (price-book ceilings), not what Google charged.</small></section>;
  const engine = engineCommittedUsd ? Number(engineCommittedUsd) : null;
  return <section className="billing-card" aria-label="Google bill" data-testid="billing-card">
    <div className="job-wallet" role="group" aria-label="Google bill for the month">
      <div className="job-wallet-main"><span className="eyebrow">GOOGLE BILL, {r.month}</span><strong data-testid="billed-net">{money(r.netUsd < 0 && r.netUsd > -0.005 ? 0 : r.netUsd)}</strong><small>charged to the card after credits</small></div>
      <dl><div><dt>Gross cost</dt><dd>{money(r.costUsd)}</dd></div><div><dt>Credits applied</dt><dd>{money(-r.creditsUsd)}</dd></div><div><dt>Covered by credit</dt><dd>{r.costUsd > 0 ? `${Math.min(100, Math.round((-r.creditsUsd / r.costUsd) * 100))}%` : 'n/a'}</dd></div></dl>
      <button type="button" onClick={() => load(true)}>Refresh</button>
    </div>
    <table className="admin-table" aria-label="Bill by service"><thead><tr><th>Service</th><th>Cost</th><th>Credits</th><th>Net</th></tr></thead><tbody>{r.rows.filter((x) => Math.abs(x.costUsd) > 0.0000005 || Math.abs(x.creditsUsd) > 0.0000005).map((x) => <tr key={x.service}><td>{x.service}</td><td>{x.costUsd.toFixed(6)}</td><td>{x.creditsUsd.toFixed(6)}</td><td>{x.netUsd.toFixed(6)}</td></tr>)}</tbody></table>
    <ul className="admin-list">
      {engine !== null && <li>Our estimates for the month (cost engine, worst-case): {money(engine)} against {money(r.costUsd)} billed: the estimates are ceilings, so billed should be at or below them.</li>}
      <li>Job cards this month (price-book ceilings for AEGIS translation, voice and renders): {data.jobCards.usd ?? 'UNKNOWN'} USD over {data.jobCards.count} cards. The bill also covers hosting and anything run outside AEGIS.</li>
      <li>Services with no charge yet (for example Text-to-Speech and Translation, inside their free allowance) do not appear in the export.</li>
    </ul>
    <small>{r.note} Data up to {r.lastUse ? when(r.lastUse) : 'unknown'}; read {when(r.fetchedAt)}.</small>
  </section>;
}
