import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from './api/client.js';
import { ModuleCard } from './components/ModuleCard.js';

type ApiState = 'working' | 'configured' | 'off' | 'not-set' | 'problem' | 'unknown';
interface ApiRow {
  id: string; name: string; purpose: string; cost: 'billed' | 'free' | 'free allowance'; state: ApiState; detail: string;
  lastCalledAt: string | null; lastOkAt: string | null; lastProblemAt: string | null; switch: string;
  switchable: boolean; switchedOff: boolean; switchedBy: string | null; switchedAt: string | null;
}
interface ApiGroup { id: string; title: string; rows: ApiRow[] }
interface ApiStatus { asOf: string; summary: { working: number; configured: number; off: number; problem: number; total: number }; groups: ApiGroup[]; remarks: string[] }

const STATE_TEXT: Record<ApiState, string> = { working: 'Working', configured: 'Configured', off: 'Off', 'not-set': 'Not set', problem: 'Problem', unknown: 'Unknown' };
const when = (iso: string | null, asOf: string): string => {
  if (!iso) return 'none recorded';
  const min = Math.round((Date.parse(asOf) - Date.parse(iso)) / 60_000);
  const text = `${iso.replace('T', ' ').slice(0, 16)} UTC`;
  return min < 0 ? text : min < 2 ? `${text} (just now)` : min < 90 ? `${text} (${min} min ago)` : min < 2880 ? `${text} (${Math.round(min / 60)} h ago)` : text;
};
const COST_TEXT: Record<ApiRow['cost'], string> = { billed: 'Billed', free: 'Free', 'free allowance': 'Free allowance' };

/** Google Maps in the page: only the browser knows whether its key is in this build, so this row is made here, not by the server. Nothing is called. */
const mapsRow = (): ApiRow => {
  const key = ((import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '').trim();
  return { id: 'maps-browser', name: 'Google Maps in the browser', purpose: 'The map on the landing page; a schematic map is shown if Google Maps cannot load.', cost: 'billed', state: key ? 'configured' : 'not-set', lastCalledAt: null, lastOkAt: null, lastProblemAt: null, switchable: false, switchedOff: false, switchedBy: null, switchedAt: null,
    detail: key ? 'A key is in this page build. Whether it works is shown by the map on the landing page; the server cannot test it.' : 'No key in this page build, so the schematic map is used.', switch: 'VITE_GOOGLE_MAPS_API_KEY (build time)' };
};

/** The API status tab: every outside service in groups (what it is for, billed or free, state, last success). It makes no call to any outside service. */
export function ApiStatusView({ token }: { token: string }) {
  const [data, setData] = useState<ApiStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState('');
  const load = useCallback((): void => {
    setBusy(true);
    apiRequest<ApiStatus>('/api/admin/api-status', { token }).then((v) => { setData(v); setError(''); })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The API status could not be loaded.'))
      .finally(() => setBusy(false));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  /** Turns a service that is set up off or back on (the server refuses anything else); the catalogue is reloaded afterwards. */
  const toggle = (row: ApiRow): void => {
    setSwitching(row.id); setSwitchError('');
    apiRequest('/api/admin/api-switch', { token, method: 'PUT', body: { id: row.id, on: row.switchedOff } })
      .then(() => load())
      .catch((e: unknown) => setSwitchError(e instanceof ApiError ? e.message : 'The switch did not change.'))
      .finally(() => setSwitching(null));
  };
  if (error) return <ModuleCard cardId="admin:apis" title="API status" collapsible={false}><p role="alert">{error}</p></ModuleCard>;
  if (!data) return <ModuleCard cardId="admin:apis" title="API status" collapsible={false}><p role="status">Loading…</p></ModuleCard>;
  const groups: ApiGroup[] = data.groups.map((g) => (g.id === 'env' ? { ...g, rows: [...g.rows, mapsRow()] } : g));
  const s = data.summary;
  return <>
    <ModuleCard cardId="admin:apis" title="API status" eyebrow="EVERY OUTSIDE SERVICE" collapsible={false}
      action={<button type="button" className="api-refresh" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Refresh'}</button>}>
      <div className="api-summary" role="status" aria-label="Summary">
        <span className="api-chip is-working"><b>{s.working}</b> working</span><span className="api-chip is-configured"><b>{s.configured}</b> configured</span>
        <span className="api-chip is-problem"><b>{s.problem}</b> problem</span><span className="api-chip is-off"><b>{s.off}</b> off or not set</span>
        <small>As of {data.asOf.replace('T', ' ').slice(0, 16)} UTC</small>
      </div>
      {switchError && <p role="alert" className="ne-error">{switchError}</p>}
      <ul className="admin-list">{data.remarks.map((r) => <li key={r}>{r}</li>)}</ul>
    </ModuleCard>
    {groups.map((g) => <ModuleCard key={g.id} cardId={`admin:apis-${g.id}`} title={g.title} eyebrow={`${g.rows.length} ${g.rows.length === 1 ? 'SERVICE' : 'SERVICES'}`} collapsible={false}>
      <div className="api-rows">{g.rows.map((r) => <div key={r.id} className={`api-row is-${r.state}`} data-api-id={r.id}>
        <div className="api-left"><span className={`api-state is-${r.state}`}>{STATE_TEXT[r.state]}</span>
          {!r.switchable && r.state !== 'off' && r.state !== 'not-set' && <span className="api-locked"><button type="button" role="switch" className="api-toggle is-on is-locked" aria-checked="true" aria-disabled="true" disabled aria-label={`${r.name} is on and locked`}><span className="api-toggle-knob"/><span className="api-toggle-text">On</span></button><small>Locked on</small></span>}
          {r.switchable && <button type="button" role="switch" className={`api-toggle${r.switchedOff ? '' : ' is-on'}`} aria-checked={!r.switchedOff} aria-label={`Switch ${r.name}`} disabled={switching === r.id} onClick={() => toggle(r)}><span className="api-toggle-knob"/><span className="api-toggle-text">{r.switchedOff ? 'Off' : 'On'}</span></button>}
        </div>
        <div className="api-main"><strong>{r.name}</strong><small>{r.purpose}</small></div>
        <span className={`api-cost is-${r.cost.replace(' ', '-')}`}>{COST_TEXT[r.cost]}</span>
        <div className="api-meta">
          <span>Last called: {when(r.lastCalledAt, data.asOf)}</span>
          <span>Last success: {when(r.lastOkAt, data.asOf)}</span>
          {r.lastProblemAt && <span className="api-bad">Last problem: {when(r.lastProblemAt, data.asOf)}</span>}
          <small>{r.detail}</small>
          <small className="api-switch">Setting: {r.switch}</small>
        </div>
      </div>)}</div>
    </ModuleCard>)}
  </>;
}
