import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiRequest } from './api/client.js';
import { ModuleCard } from './components/ModuleCard.js';

interface PinRow { pinId: string; name: string; country: string; region: string; lat: number; lng: number; roles: string[]; origin: 'fixture' | 'admin'; removed: boolean; lastUpdatedAt: string | null; readingState: 'fresh' | 'expired' | 'never' | 'demo'; meteoRows: number; meteoLatestHour: string | null }
interface Listing {
  total: number; pins: PinRow[]; asOf: string;
  summary: { active: number; removed: number; added: number; byCountry: Record<string, number>; withLive: number; withDemo: number; withMeteo: number; withoutMeteo: number };
  filters: { regions: { country: string; region: string; count: number }[] };
  sources: { sourceId: string; state: string; lastOkAt: string | null }[];
  capabilities: { google: boolean; openaq: boolean };
}
interface Result { source: string; outcome: string; detail: string }
interface HistoryRow { seq: number; action: string; pinId: string | null; by: string; at: string; note: string | null }

const SOURCES = [
  { id: 'usgs-gdacs', label: 'USGS earthquakes and GDACS alerts', note: 'free' },
  { id: 'psi', label: 'NEA PSI, Singapore', note: 'free' },
  { id: 'metmy', label: 'MetMalaysia warnings and forecast', note: 'free' },
  { id: 'openmeteo', label: 'Open-Meteo 7-day modelled history', note: 'free, modelled' },
  { id: 'openaq', label: 'OpenAQ nearby stations', note: 'free, needs the key' },
  { id: 'google', label: 'Google air quality and weather', note: 'BILLED, shown for one hour, never saved' },
] as const;
const fmt = (iso: string | null): string => (iso ? iso.replace('T', ' ').slice(5, 16) + ' UTC' : 'never');
const errText = (e: unknown): string => (e instanceof ApiError ? e.message : 'Something went wrong.');
const tone = (s: PinRow['readingState']): 'ok' | 'warn' | 'off' => (s === 'fresh' ? 'ok' : s === 'demo' ? 'warn' : 'off');
const Badge = ({ t, children }: { t: 'ok' | 'warn' | 'off'; children: ReactNode }) => <span className={`admin-badge admin-${t}`}>{children}</span>;

/** Admin Desk > Data control (AEG-DATA-001): pin list with filters, refresh of chosen sources, dummy data, add, delete, restore, export and history. */
export function DataControl({ token }: { token: string }) {
  const [data, setData] = useState<Listing | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [f, setF] = useState({ country: '', region: '', role: '', status: '', origin: '', meteo: '', q: '', removed: false });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set(['usgs-gdacs', 'psi', 'metmy', 'openmeteo']));
  const [scope, setScope] = useState<'all' | 'filtered' | 'selected'>('all');
  const [confirmGoogle, setConfirmGoogle] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [form, setForm] = useState({ name: '', country: 'MY', region: '', lat: '', lng: '', hazard: false });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== '' && v !== false) p.set(k, v === true ? '1' : String(v));
    p.set('limit', '500');
    return p.toString();
  }, [f]);
  const load = useCallback((): void => {
    apiRequest<Listing>(`/api/admin/pins?${qs}`, { token }).then((v) => { setData(v); setError(''); }).catch((e: unknown) => setError(errText(e)));
    apiRequest<{ history: HistoryRow[] }>('/api/admin/pins/history', { token }).then((v) => setHistory(v.history)).catch(() => setHistory([]));
  }, [qs, token]);
  useEffect(() => { load(); }, [load]);

  const regions = (data?.filters.regions ?? []).filter((r) => !f.country || r.country === f.country);
  const idsFor = (s: typeof scope): string[] | undefined => (s === 'all' ? undefined : s === 'filtered' ? (data?.pins ?? []).map((p) => p.pinId) : [...picked]);
  const run = (label: string, job: () => Promise<void>): void => { setBusy(label); setNote(''); job().catch((e: unknown) => setNote(errText(e))).finally(() => { setBusy(''); load(); }); };

  const refreshNow = (): void => run('refresh', async () => {
    const pinIds = idsFor(scope);
    if (scope !== 'all' && (!pinIds || pinIds.length === 0)) { setNote('No pins in that scope.'); return; }
    const r = await apiRequest<{ results: Result[]; pins: number }>('/api/admin/data/refresh', { token, method: 'POST', body: { sources: [...ticked], ...(pinIds ? { pinIds } : {}), confirmGoogle: ticked.has('google') && confirmGoogle } });
    setResults(r.results); setNote(`Refresh finished for ${r.pins} pins.`); setConfirmGoogle(false);
  });
  const dummy = (action: 'load' | 'clear', scoped: boolean): void => run('dummy', async () => {
    const pinIds = scoped ? [...picked] : undefined;
    if (scoped && picked.size === 0) { setNote('Select pins in the list first.'); return; }
    const r = await apiRequest<{ loaded?: number; cleared?: number; pins?: number }>('/api/admin/data/dummy', { token, method: 'POST', body: { action, ...(pinIds ? { pinIds } : {}) } });
    setNote(action === 'load' ? `Loaded ${r.loaded} demo readings for ${r.pins} pins. Labelled DEMO, kept for one hour, not Google data.` : `Cleared ${r.cleared} demo readings.`);
  });
  const addPin = (): void => run('add', async () => {
    const r = await apiRequest<{ pin: { pinId: string }; meteo: string }>('/api/admin/pins', { token, method: 'POST', body: { name: form.name, country: form.country, region: form.region, lat: Number(form.lat), lng: Number(form.lng), roles: form.hazard ? ['general', 'hazard'] : ['general'] } });
    setNote(`Added ${r.pin.pinId}. Open-Meteo history: ${r.meteo}.`); setForm({ ...form, name: '', lat: '', lng: '' });
  });
  const del = (p: PinRow): void => { if (window.confirm(`Delete ${p.name} (${p.pinId})? ${p.origin === 'admin' ? 'An added pin is removed for good.' : 'A pin from the owner\'s list can be restored later.'}`)) run('delete', async () => { await apiRequest(`/api/admin/pins/${p.pinId}`, { token, method: 'DELETE' }); setPicked((s) => { const n = new Set(s); n.delete(p.pinId); return n; }); setNote(`Deleted ${p.pinId}.`); }); };
  const delPicked = (): void => { if (picked.size > 0 && window.confirm(`Delete ${picked.size} pins?`)) run('delete', async () => { for (const id of picked) await apiRequest(`/api/admin/pins/${id}`, { token, method: 'DELETE' }); setPicked(new Set()); setNote(`Deleted ${picked.size} pins.`); }); };
  const restore = (p: PinRow): void => run('restore', async () => { await apiRequest(`/api/admin/pins/${p.pinId}/restore`, { token, method: 'POST', body: {} }); setNote(`Restored ${p.pinId}.`); });
  const pinRefresh = (p: PinRow, google: boolean): void => {
    if (google && !window.confirm(`Fetch live Google air and weather for ${p.name}? This is a billed call (about 3 requests).`)) return;
    run('pin', async () => {
      const r = await apiRequest<{ results: Result[] }>(`/api/admin/pins/${p.pinId}/refresh`, { token, method: 'POST', body: { sources: google ? ['google'] : ['openmeteo'], confirmGoogle: google } });
      setNote(`${p.pinId}: ${r.results.map((x) => `${x.source} ${x.outcome} (${x.detail})`).join('; ')}`);
    });
  };
  const exportCsv = (): void => run('export', async () => {
    const res = await fetch('/api/admin/pins/export.csv', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError('E_EXPORT', 'Export failed.');
    const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = 'aegis-pins.csv'; a.click(); URL.revokeObjectURL(url);
    setNote('Exported pin names and coordinates (no readings).');
  });
  const toggle = (set: Set<string>, id: string, on: (s: Set<string>) => void): void => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); on(n); };
  const allShown = data ? data.pins.length > 0 && data.pins.every((p) => picked.has(p.pinId)) : false;

  if (error) return <ModuleCard cardId="admin:data-error" title="Data control unavailable" collapsible={false}><p role="alert">{error}</p></ModuleCard>;
  if (!data) return <ModuleCard cardId="admin:data-loading" title="Loading" collapsible={false}><p role="status">Loading pins…</p></ModuleCard>;
  const s = data.summary;
  return <>
    <ModuleCard cardId="admin:data-summary" title="Pin data at a glance" eyebrow="DATA CONTROL" collapsible={false}>
      <div className="admin-stats">
        <div className="admin-stat"><span>Active pins</span><strong>{s.active}</strong><small>SG {s.byCountry['SG']} · MY {s.byCountry['MY']} · BN {s.byCountry['BN']}</small></div>
        <div className="admin-stat"><span>Added / deleted</span><strong>{s.added} / {s.removed}</strong><small>by administrators</small></div>
        <div className="admin-stat"><span>Live Google now</span><strong>{s.withLive}</strong><small>shown for one hour only</small></div>
        <div className="admin-stat"><span>Demo data</span><strong>{s.withDemo}</strong><small>synthetic, labelled DEMO</small></div>
        <div className="admin-stat"><span>With 7-day history</span><strong>{s.withMeteo}</strong><small>{s.withoutMeteo} without (Open-Meteo)</small></div>
      </div>
      <table className="admin-table"><thead><tr><th>Source</th><th>State</th><th>Last OK</th></tr></thead><tbody>{data.sources.map((x) => <tr key={x.sourceId}><td>{x.sourceId}</td><td><Badge t={x.state === 'OK' ? 'ok' : 'warn'}>{x.state}</Badge></td><td>{fmt(x.lastOkAt)}</td></tr>)}</tbody></table>
      {note && <p role="status"><strong>{busy ? 'Working… ' : ''}</strong>{note}</p>}
    </ModuleCard>

    <ModuleCard cardId="admin:data-refresh" title="Refresh data" eyebrow="TICK THE SOURCES" collapsible={false}>
      <fieldset className="data-ticks"><legend>Sources to refresh now</legend>{SOURCES.map((x) => <label key={x.id}><input type="checkbox" checked={ticked.has(x.id)} disabled={x.id === 'google' && !data.capabilities.google} onChange={() => toggle(ticked, x.id, setTicked)}/> {x.label} <small>({x.note}{x.id === 'google' && !data.capabilities.google ? '; keys not set on this server' : ''}{x.id === 'openaq' && !data.capabilities.openaq ? '; key not set' : ''})</small></label>)}</fieldset>
      <fieldset className="data-ticks"><legend>Pins</legend>
        <label><input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')}/> All {s.active} pins</label>
        <label><input type="radio" name="scope" checked={scope === 'filtered'} onChange={() => setScope('filtered')}/> The {data.total} pins in the list below</label>
        <label><input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')}/> The {picked.size} ticked pins</label>
      </fieldset>
      {ticked.has('google') && <p className="data-warn"><label><input type="checkbox" checked={confirmGoogle} onChange={(e) => setConfirmGoogle(e.target.checked)}/> I confirm this is a billed Google call (about 3 requests per pin, through the quota gate, one run per 10 minutes). Readings are shown for one hour and never saved.</label></p>}
      <p><button type="button" disabled={busy !== '' || ticked.size === 0 || (ticked.has('google') && !confirmGoogle)} onClick={refreshNow}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}</button> <small>The free sources can take a minute.</small></p>
      {results.length > 0 && <ul className="admin-list" aria-label="Refresh results">{results.map((r) => <li key={r.source}><strong>{r.source}</strong>: {r.outcome}. {r.detail}</li>)}</ul>}
    </ModuleCard>

    <ModuleCard cardId="admin:data-demo" title="Dummy data" eyebrow="FOR TESTING THE MAP AND PIN CARDS" collapsible={false}>
      <p>Loads synthetic air and temperature readings so the map, the pin cards and the temperature rings can be tried with no live call. They are labelled DEMO, kept in memory for one hour, and are not Google data.</p>
      <p><button type="button" disabled={busy !== ''} onClick={() => dummy('load', false)}>Load dummy data for all pins</button> <button type="button" disabled={busy !== '' || picked.size === 0} onClick={() => dummy('load', true)}>Load for the {picked.size} ticked pins</button> <button type="button" disabled={busy !== ''} onClick={() => dummy('clear', false)}>Clear dummy data</button></p>
    </ModuleCard>

    <ModuleCard cardId="admin:data-add" title="Add a pin" eyebrow="NEW MONITORED PLACE" collapsible={false}>
      <div className="data-form">
        <label>Name<input type="text" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
        <label>Country<select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}><option value="MY">Malaysia</option><option value="SG">Singapore</option><option value="BN">Brunei</option></select></label>
        <label>State or region<input type="text" list="data-regions" value={form.region} maxLength={60} onChange={(e) => setForm({ ...form, region: e.target.value })}/><datalist id="data-regions">{(data.filters.regions).filter((r) => r.country === form.country).map((r) => <option key={r.region} value={r.region}/>)}</datalist></label>
        <label>Latitude<input type="number" step="0.00001" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })}/></label>
        <label>Longitude<input type="number" step="0.00001" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })}/></label>
        <label className="data-inline"><input type="checkbox" checked={form.hazard} onChange={(e) => setForm({ ...form, hazard: e.target.checked })}/> also a hazard pin</label>
        <button type="button" disabled={busy !== '' || !form.name.trim() || !form.region.trim() || form.lat === '' || form.lng === ''} onClick={addPin}>Add pin</button>
      </div>
      <small>The point must be inside the chosen country and at least 500 m from another pin. Its 7-day Open-Meteo history is fetched at once. A new pin is marked "not yet checked against the owner's list".</small>
    </ModuleCard>

    <ModuleCard cardId="admin:data-pins" title={f.removed ? 'Deleted pins' : 'Pins and their data'} eyebrow={`${data.total} SHOWN`} collapsible={false}>
      <div className="data-filters" role="group" aria-label="Filters">
        <label>Country<select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value, region: '' })}><option value="">All</option><option value="SG">Singapore</option><option value="MY">Malaysia</option><option value="BN">Brunei</option></select></label>
        <label>State or region<select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}><option value="">All</option>{regions.map((r) => <option key={`${r.country}${r.region}`} value={r.region}>{r.region} ({r.count})</option>)}</select></label>
        <label>Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="">All</option><option value="general">General</option><option value="hazard">Hazard</option></select></label>
        <label>Data now<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any</option><option value="fresh">Live Google</option><option value="demo">Demo</option><option value="expired">Expired</option><option value="never">None</option></select></label>
        <label>History<select value={f.meteo} onChange={(e) => setF({ ...f, meteo: e.target.value })}><option value="">Any</option><option value="with">With 7-day history</option><option value="without">Without</option></select></label>
        <label>Origin<select value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })}><option value="">Any</option><option value="fixture">Owner's list</option><option value="admin">Added here</option></select></label>
        <label>Search<input type="search" value={f.q} placeholder="name, id or state" onChange={(e) => setF({ ...f, q: e.target.value })}/></label>
        <label className="data-inline"><input type="checkbox" checked={f.removed} onChange={(e) => setF({ ...f, removed: e.target.checked })}/> show deleted</label>
        <button type="button" onClick={() => setF({ country: '', region: '', role: '', status: '', origin: '', meteo: '', q: '', removed: false })}>Clear filters</button>
      </div>
      <p>{!f.removed && <><button type="button" disabled={busy !== '' || picked.size === 0} onClick={delPicked}>Delete {picked.size} ticked</button> </>}<button type="button" disabled={busy !== ''} onClick={exportCsv}>Export CSV (names and coordinates)</button></p>
      <div className="data-tablewrap"><table className="admin-table data-pins">
        <thead><tr><th><input type="checkbox" aria-label="Tick all shown" checked={allShown} onChange={() => setPicked(allShown ? new Set() : new Set(data.pins.map((p) => p.pinId)))}/></th><th>Pin</th><th>Country</th><th>State or region</th><th>Location</th><th>Origin</th><th>Last updated</th><th>Data now</th><th>7-day rows</th><th>Actions</th></tr></thead>
        <tbody>{data.pins.map((p) => <tr key={p.pinId}>
          <td><input type="checkbox" aria-label={`Tick ${p.name}`} checked={picked.has(p.pinId)} onChange={() => toggle(picked, p.pinId, setPicked)}/></td>
          <td><strong>{p.name}</strong><br/><small>{p.pinId}{p.roles.includes('hazard') ? ' · hazard' : ''}</small></td>
          <td>{p.country}</td><td>{p.region}</td><td>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</td><td>{p.origin === 'admin' ? 'Added here' : 'Owner\'s list'}</td>
          <td>{fmt(p.lastUpdatedAt)}</td><td><Badge t={tone(p.readingState)}>{p.readingState === 'never' ? 'none' : p.readingState}</Badge></td><td>{p.meteoRows}</td>
          <td className="data-actions">{p.removed ? <button type="button" disabled={busy !== ''} onClick={() => restore(p)}>Restore</button> : <><button type="button" disabled={busy !== ''} onClick={() => pinRefresh(p, false)} title="Open-Meteo 7-day history (free)">Refresh</button> <button type="button" disabled={busy !== '' || !data.capabilities.google} onClick={() => pinRefresh(p, true)} title="Live Google reading (billed)">Google</button> <button type="button" disabled={busy !== ''} onClick={() => del(p)}>Delete</button></>}</td>
        </tr>)}</tbody>
      </table></div>
      {data.pins.length === 0 && <p>No pins match these filters.</p>}
    </ModuleCard>

    <ModuleCard cardId="admin:data-history" title="What was done here" eyebrow="HISTORY, NEWEST FIRST" collapsible={false}>
      {history.length === 0 ? <p>Nothing yet.</p> : <ul className="admin-list">{history.map((h) => <li key={h.seq}>{fmt(h.at)} · <strong>{h.action}</strong>{h.pinId ? ` ${h.pinId}` : ''} · {h.by}{h.note ? ` · ${h.note}` : ''}</li>)}</ul>}
    </ModuleCard>
  </>;
}
