import { InfoTip } from './InfoTip.js';
import { ApiStatusView } from './ApiStatusView.js';
import { SpendStats } from './SpendLimitsEdit.js';
import { adminSections } from './formulations/pageTemplates.js';
import { WorkspaceShell } from './shell/WorkspaceShell.js';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiRequest } from './api/client.js';
import { ModuleCard } from './components/ModuleCard.js';
import { SignInScreen } from './components/SignInScreen.js';
import { useWorkspaceStore } from './state/store.js';
import { ScreeningRoom } from './ScreeningRoom.js';
import { DataControl } from './DataControl.js';
import { BillingCard, JobCards } from './JobCards.js';
import './dashboard/dashboard.css';
import './dashboard/dock.css';
import './admin.css';

/** Shows a money amount with 4 decimals (display only: the stored value keeps its full precision). Anything that is not a plain number is shown as it is. */
const usd4 = (value: string): string => (/^-?\d+(\.\d+)?$/.test(value) ? Number(value).toFixed(4) : value);

interface Desk {
  generatedAt: string;
  spend: null | {
    period: string; budgetUsd: string; committedUsd: string; remainingUsd: string; autoApproveUsd: string; capEnforced: boolean;
    funding: { source: string; balanceUsd: string; committedUsd: string; remainingUsd: string; expires: string | null }[];
    waitingForOwner: { seq: number; actionId: string }[]; flagged: number[]; unexplained: { count: number; usd: string }; cardExposureUsd: string; creditAssumedUsd: string;
  };
  models: { enabled: boolean; providerMode: string; committedMicro: number; limits: { accountMicro: number; dayMicro: number; taskMicro: number } };
  feeds: {
    liveTimerOn: boolean; sources: { sourceId: string; state: string; lastOkAt: string | null; lastAttemptAt: string; detail: string | null }[]; publicEvidence: number;
    dataConfidence: { score: number | null; band: string | null; provisional: true };
    googleEnvironment: { refreshOn: boolean; scheduledRefreshOn: boolean; lastRunAt: string | null; readingsHeld: number };
  };
  broadcast: {
    scheduleVersion: string; slots: { id: string; airLocal: string; captureLocal: string; airUtc: string; captureUtc: string }[]; next: { slotId: string; captureAt: string; airAt: string }; narratedSources: string[]; neverNarrated: string[]; languages: { code: string; label: string; state: 'active' | 'locked'; note: string }[];
    render: { state: string; gpuPriced: boolean; gates: { seq: number; actionId: string; decision: string; estimateUsd: string; approved: boolean; hasActual: boolean }[]; test: { runSheet: string; scriptReady: boolean; outputReady: boolean }; lastGate: { seq: number; actionId: string; decision: string; estimateUsd: string; approved: boolean; hasActual: boolean } | null; note: string };
    latestBulletin: { bulletinId: string; slotId: string; captureAt: string; generatedAt: string; factSheetHash: string; segments: number } | null;
  };
  remarks: string[];
}

const TABS = adminSections;
type TabId = typeof TABS[number]['id'];
const when = (iso: string | null): string => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : 'never');
const Stat = ({ label, value, note }: { label: string; value: ReactNode; note?: string }) => <div className="admin-stat"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
const Badge = ({ tone, children }: { tone: 'ok' | 'warn' | 'off'; children: ReactNode }) => <span className={`admin-badge admin-${tone}`}>{children}</span>;

/** Admin Desk (AEG-ADMIN-001): cards inside cards, read-only. SOL will restyle; the structure and the data are the contract. */
export function AdminRoute() {
  const [state, dispatch] = useWorkspaceStore();
  const token = state.session?.token;
  const isAdmin = state.session?.user.isAdmin === true;
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(0);
  const [tab, setTab] = useState<TabId>(() => { try { const raw = new URLSearchParams(window.location.search).get('tab'); const t = raw === 'data' ? 'feeds' : raw; return TABS.some((x) => x.id === t) ? t as TabId : 'approval'; } catch { return 'approval'; } });
  const chooseTab = (id: TabId): void => { setTab(id); try { const url = new URL(window.location.href); url.searchParams.set('tab', id); window.history.replaceState(null, '', url); } catch { /* the tab still changes */ } };

  const [spendPeriod, setSpendPeriod] = useState<string | null>(null);   // the month chosen on the Spend card; null means the current period
  const [refresh, setRefresh] = useState(0);   // bumped after the spend limits are edited so the desk reloads
  useEffect(() => {
    if (!token || !isAdmin) return;
    let live = true;
    const load = (): void => {
      apiRequest<Desk>('/api/admin/desk', { token }).then((value) => { if (live) { setDesk(value); setError(''); } })
        .catch((reason: unknown) => { if (live) setError(reason instanceof ApiError ? `${reason.code}: ${reason.message}` : 'The desk could not be loaded.'); });
    };
    // Bulletins stored but not yet approved or held: the number on the News approval tab.
    const count = (): void => { apiRequest<{ now: string; stored: { review: unknown; slotId: string; airAt: string }[] }>('/api/admin/screening', { token }).then((v) => { if (live) setWaiting(v.stored.filter((b) => !b.review && b.slotId !== 'drill' && Date.parse(b.airAt) + 60 * 60_000 >= Date.parse(v.now)).length); }).catch(() => undefined); };
    load(); count();
    const timer = setInterval(() => { load(); count(); }, 60_000);
    return () => { live = false; clearInterval(timer); };
  }, [token, isAdmin, refresh]);

  return <WorkspaceShell page="admin"><main id="dashboard-main" className="admin-desk" tabIndex={-1} aria-label="Admin Desk">
    <nav className="admin-tabs" role="tablist" aria-label="Admin sections">{TABS.map(t=><button key={t.id} role="tab" id={`admin-tab-${t.id}`} aria-selected={tab===t.id} aria-controls="admin-panel" className={tab===t.id?'is-active':''} onClick={()=>chooseTab(t.id)}>{t.label}{t.id==='approval'&&waiting>0&&<span className="admin-tab-badge" aria-label={`${waiting} waiting for review`}>{waiting}</span>}</button>)}</nav>
    <h1 className="sr-only">Admin Desk</h1>
    {!token ? <ModuleCard cardId="admin:sign-in" title="Sign in" eyebrow="ADMINISTRATORS" collapsible={false}><SignInScreen dispatch={dispatch}/></ModuleCard>
      : !isAdmin ? <ModuleCard cardId="admin:forbidden" title="Administrators only" collapsible={false}><p>This account is not an administrator.</p></ModuleCard>
      : error ? <ModuleCard cardId="admin:error" title="Desk unavailable" collapsible={false}><p role="alert">{error}</p></ModuleCard>
      : !desk ? <ModuleCard cardId="admin:loading" title="Loading" collapsible={false}><p role="status">Loading the desk…</p></ModuleCard>
      : <>
      <div className={`admin-grid${tab === 'approval' ? ' is-approval' : tab === 'feeds' ? ' is-wide' : ''}`} role="tabpanel" id="admin-panel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'spend' && <>
        {(() => { const spend = desk.spend; return spend === null ? <ModuleCard cardId="admin:spend" title="Spend and cost gate" eyebrow="NOT ON THIS SERVER" action={<Badge tone="off">Unavailable here</Badge>}><p>The cost ledger and the price book live with the engineer and the operations agent, not in this server's image. Run <code>npm run cost -- status</code> where the ledger is.</p></ModuleCard> : <ModuleCard cardId="admin:spend" title="Spend and cost gate" eyebrow="COST ENGINE" action={spend.capEnforced ? <Badge tone="ok">Cap enforced</Badge> : <Badge tone="warn">No enforced cap recorded</Badge>}>
          {(() => {
            const [py, pm] = spend.period.split('-').map(Number) as [number, number];
            const months = [0, 1, 2, 3].map((i) => { const d = new Date(Date.UTC(py, pm - 1 - i, 1)); return { value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: `${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}${i === 0 ? ' (current)' : ''}` }; });
            const chosen = spendPeriod ?? spend.period;
            return <>
              <label className="spend-period">Period <select value={chosen} onChange={(e) => setSpendPeriod(e.target.value === spend.period ? null : e.target.value)}>{months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
              {chosen !== spend.period && <p className="spend-none" role="status">No figures for {months.find((m) => m.value === chosen)?.label}. This view holds the current period only ({spend.period}); the cost engine does not keep a monthly budget or a ledger summary for earlier months here yet.</p>}
            </>;
          })()}
          {(spendPeriod === null || spendPeriod === spend.period) && <>
          <SpendStats token={token} budget={spend.budgetUsd} committed={spend.committedUsd} remaining={spend.remainingUsd} auto={spend.autoApproveUsd} onSaved={() => setRefresh((n) => n + 1)}/>
          <div className="admin-subcards">{spend.funding.map((f) => <section className="admin-subcard" key={f.source} aria-label={f.source}><span className="eyebrow">{f.source.replace('_', ' ')}</span><strong>{usd4(f.remainingUsd)} USD left</strong><small>of {usd4(f.balanceUsd)} USD · committed {usd4(f.committedUsd)}{f.expires ? ` · expires ${f.expires}` : ''}</small></section>)}</div>
          <ul className="admin-list">
            <li>{spend.waitingForOwner.length === 0 ? 'Nothing waiting for the owner.' : `Waiting for the owner: ${spend.waitingForOwner.map((o) => `#${o.seq} ${o.actionId}`).join(', ')}`}<InfoTip label="What does waiting for the owner mean?">The cost gate paused these planned actions because they cost more than the per-action limit, or their price is not known. Each one runs only after you say yes. The number is its line in the cost ledger and the text is the action's id.</InfoTip></li>
            <li>Credit coverage still assumed (no billing report yet): {usd4(spend.creditAssumedUsd)} USD<InfoTip label="What does credit coverage assumed mean?">The free GCP credit should pay for these charges, but no billing report has confirmed it yet. This is the amount we are counting as covered by the credit. It stays an assumption until a billing report shows the credit actually applied.</InfoTip></li>
            <li>Card exposure: {usd4(spend.cardExposureUsd)} USD · unexplained charges: {spend.unexplained.count} ({usd4(spend.unexplained.usd)} USD) · flagged reconciliations: {spend.flagged.length}<InfoTip label="What do card exposure, unexplained charges and flagged reconciliations mean?"><strong>Card exposure:</strong> the part of a charge the credit did not cover, which reaches the payment card. <strong>Unexplained charges:</strong> charges with no matching estimate in the ledger (0 means every charge has one). <strong>Flagged reconciliations:</strong> real costs that differed from their estimate by more than the larger of 0.05 USD and 25 percent, or that were not fully covered by the credit.</InfoTip></li>
          </ul>
        </>}
        </ModuleCard>; })()}
        {/* Two columns, each a stack: the left column has the model budget, then the job cards straight under it; the right has the Google bill. No row gap under the shorter card. */}
        <div className="admin-cols">
          <div className="admin-col">
        <ModuleCard cardId="admin:models" title="AI model budget" eyebrow="GATEWAY" action={desk.models.enabled ? <Badge tone="ok">Models on</Badge> : <Badge tone="off">Models off</Badge>}>
          <div className="admin-stats"><Stat label="Provider mode" value={desk.models.providerMode}/><Stat label="Committed" value={`${desk.models.committedMicro} µUSD`}/><Stat label="Per request cap" value={`${desk.models.limits.taskMicro} µUSD`}/><Stat label="Per day cap" value={`${desk.models.limits.dayMicro} µUSD`}/></div>
        </ModuleCard>
        <ModuleCard cardId="admin:jobs" title="Job cards and credit" eyebrow="EVERY JOB IS A CARD WITH A UUID"><JobCards token={token}/></ModuleCard>
          </div>
          <div className="admin-col">
        <ModuleCard cardId="admin:billing" title="Google bill (real charges)" eyebrow="FROM THE BILLING EXPORT, READ-ONLY"><BillingCard token={token} engineCommittedUsd={desk.spend?.committedUsd ?? null}/></ModuleCard>
          </div>
        </div>
        </>}
        {tab === 'apis' && <ApiStatusView token={token}/>}
        {tab === 'feeds' && <>
        <ModuleCard cardId="admin:feeds" title="Live feeds and data" eyebrow="SOURCES" action={desk.feeds.liveTimerOn ? <Badge tone="ok">Live timer on</Badge> : <Badge tone="off">Live timer off</Badge>}>
          <div className="admin-subcards">
            <section className="admin-subcard" aria-label="Data confidence"><span className="eyebrow">DATA CONFIDENCE <Badge tone="warn">Provisional</Badge></span><strong>{desk.feeds.dataConfidence.score === null ? 'Not assessed' : `${desk.feeds.dataConfidence.score} · ${desk.feeds.dataConfidence.band}`}</strong><small>Formula to be fine-tuned later (C0011).</small></section>
            <section className="admin-subcard" aria-label="Google environment"><span className="eyebrow">GOOGLE AIR AND WEATHER</span><strong>{desk.feeds.googleEnvironment.scheduledRefreshOn ? 'Scheduled refresh ON (4 a day)' : 'Scheduled refresh OFF'}</strong><small>{desk.feeds.googleEnvironment.refreshOn && !desk.feeds.googleEnvironment.scheduledRefreshOn ? 'A one-off test capture has run. ' : ''}Last run {when(desk.feeds.googleEnvironment.lastRunAt)} · readings held {desk.feeds.googleEnvironment.readingsHeld} (memory only, one hour)</small></section>
            <section className="admin-subcard" aria-label="Public evidence"><span className="eyebrow">PUBLIC EVIDENCE</span><strong>{desk.feeds.publicEvidence}</strong><small>records held</small></section>
          </div>
          <table className="admin-table"><thead><tr><th>Source</th><th>State</th><th>Last OK</th><th>Last attempt</th></tr></thead><tbody>{desk.feeds.sources.map((s) => <tr key={s.sourceId}><td>{s.sourceId}</td><td><Badge tone={s.state === 'OK' ? 'ok' : 'warn'}>{s.state}</Badge></td><td>{when(s.lastOkAt)}</td><td>{when(s.lastAttemptAt)}</td></tr>)}</tbody></table>
        </ModuleCard>
        <DataControl token={token}/>
        </>}
        {tab === 'approval' && <ScreeningRoom token={token}/>}
        {tab === 'news' && <>
        <ModuleCard cardId="admin:broadcast" title="Aegis Broadcast Desk" eyebrow="4 BULLETINS A DAY" action={desk.broadcast.latestBulletin ? <Badge tone="ok">Script generator on</Badge> : <Badge tone="off">No bulletin yet</Badge>}>
          <div className="admin-subcards">{desk.broadcast.slots.map((s) => <section className={`admin-subcard${desk.broadcast.next.slotId === s.id ? ' is-next' : ''}`} key={s.id} aria-label={`Slot ${s.airLocal}`}><span className="eyebrow">{desk.broadcast.next.slotId === s.id ? 'NEXT SLOT' : 'SLOT'}</span><strong>{s.airLocal} air</strong><small>Data captured {s.captureLocal} · {s.captureUtc} UTC capture · Malaysia and Singapore time</small></section>)}</div>
          <ul className="admin-list"><li>Narrated sources: {desk.broadcast.narratedSources.join('; ')}.</li><li>Never narrated: {desk.broadcast.neverNarrated.join('; ')} (display only).</li><li>Schedule file version {desk.broadcast.scheduleVersion}. Next capture {when(desk.broadcast.next.captureAt)}.</li><li>{desk.broadcast.latestBulletin ? `Latest bulletin ${desk.broadcast.latestBulletin.slotId}, captured ${when(desk.broadcast.latestBulletin.captureAt)}, ${desk.broadcast.latestBulletin.segments} segments, facts ${desk.broadcast.latestBulletin.factSheetHash.slice(0, 12)}` : 'No bulletin generated yet.'}</li></ul>
          <ModuleCard cardId="admin:broadcast-languages" title="Languages" eyebrow="VOICE AND SCRIPT" collapsible={false}>
            <ul className="admin-languages">{desk.broadcast.languages.map((l) => <li key={l.code} className={l.state === 'locked' ? 'is-locked' : ''}><span aria-hidden="true">{l.state === 'locked' ? '🔒' : '●'}</span><strong>{l.label}</strong><Badge tone={l.state === 'locked' ? 'off' : 'ok'}>{l.state === 'locked' ? 'Review required' : 'Active'}</Badge><small>{l.note}</small></li>)}</ul>
          </ModuleCard>
          <ModuleCard cardId="admin:broadcast-render" title="GPU render on GCP" eyebrow="COST GATED" collapsible={false} action={<Badge tone="warn">{desk.broadcast.render.state.replaceAll('_', ' ')}</Badge>}>
            <p>{desk.broadcast.render.note}</p><p><strong>GPU price in the price book:</strong> {desk.broadcast.render.gpuPriced ? 'yes (Singapore, read 2026-10-16)' : 'no (unknown is never free)'}</p>{desk.broadcast.render.lastGate && <p><strong>Last gate:</strong> #{desk.broadcast.render.lastGate.seq} {desk.broadcast.render.lastGate.actionId} · {desk.broadcast.render.lastGate.decision} · worst case {desk.broadcast.render.lastGate.estimateUsd} USD · {desk.broadcast.render.lastGate.hasActual ? 'actual recorded' : 'no actual recorded yet'}</p>}
            <table className="admin-table" aria-label="Render gates"><thead><tr><th>Ledger</th><th>Action</th><th>Decision</th><th>Worst case</th><th>Approved</th><th>Actual</th></tr></thead><tbody>{desk.broadcast.render.gates.map((g) => <tr key={g.seq}><td>#{g.seq}</td><td>{g.actionId}</td><td><Badge tone={g.decision === 'GO' || g.approved ? 'ok' : g.decision === 'STOP' ? 'off' : 'warn'}>{g.decision}</Badge></td><td>{g.estimateUsd} USD</td><td>{g.decision === 'GO' ? 'not needed' : g.approved ? 'yes' : 'waiting'}</td><td>{g.hasActual ? 'recorded' : 'not yet'}</td></tr>)}</tbody></table>
            <ul className="admin-list"><li><strong>First news test:</strong> script {desk.broadcast.render.test.scriptReady ? 'ready (render/out/script.txt, narrated sources only, no Google data)' : 'not generated yet'}; video {desk.broadcast.render.test.outputReady ? 'received (render/out/news-test-1)' : 'not rendered yet'}.</li><li>Run sheet for whoever runs gcloud: {desk.broadcast.render.test.runSheet}. The engineer never runs a cloud command; record the actual against the ESTIMATE ledger number.</li><li>Cloud Storage for weights and output is not priced yet (UNKNOWN is never free).</li></ul>
          </ModuleCard>
        </ModuleCard>
        </>}
        {tab === 'notes' && <>
        <ModuleCard cardId="admin:remarks" title="Remarks" eyebrow="WHAT THIS VIEW CANNOT SHOW"><ul className="admin-list">{desk.remarks.map((r) => <li key={r}>{r}</li>)}</ul><small>Generated {when(desk.generatedAt)}</small></ModuleCard>
        </>}
      </div></>}
      </main></WorkspaceShell>;
}
