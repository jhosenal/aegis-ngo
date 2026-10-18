import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HazardIcon, hazardIconPaths } from '../components/HazardIcon.js';
import { clusterByGrid } from './cluster.js';
import { loadGoogleMaps } from './googleMaps.js';
import {
  creditLine, domainName, factTiles, filterHistory, loadHistory, monthEnd, monthIndexForTime, monthLabel, monthStarts,
  recentHistoryRange, retrievedLabel, splitTitle, symbolForDomain, whenLabel,
  type HistoryCard, type HistoryData, type HistoryRangeMs,
} from './history.js';
import './hazard-history.css';

const PAGE = 30;
const MAP_BOUNDS = { west: 92, east: 142, south: -12, north: 24 };

/** Colour name for a rating value as its own scale words it: GDACS and PAGER colours, and the NEA PSI bands (green, blue, yellow, orange, red). */
function ratingTone(value: string | null): string {
  switch ((value ?? '').trim().toUpperCase()) {
    case 'GREEN': return 'green';
    case 'YELLOW': return 'yellow';
    case 'ORANGE': return 'orange';
    case 'RED': return 'red';
    case 'MODERATE': return 'blue';
    case 'UNHEALTHY': return 'yellow';
    case 'VERY UNHEALTHY': return 'orange';
    case 'HAZARDOUS': return 'red';
    default: return 'neutral';
  }
}
const point = (c: HistoryCard) => (c.location.latE6 === null || c.location.lonE6 === null ? null : { lat: c.location.latE6 / 1e6, lng: c.location.lonE6 / 1e6 });

/** Offline or key-less map: a plain projection of the same points, so the time range and selection still work. */
function SvgMap({ cards, selectedId, onSelect }: { cards: HistoryCard[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <div className="history-svg-wrap"><SvgMapPlot cards={cards} selectedId={selectedId} onSelect={onSelect}/><p className="history-svg-note-html">Simple outline map shown because Google Maps is not available here.</p></div>;
}
function SvgMapPlot({ cards, selectedId, onSelect }: { cards: HistoryCard[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const W = 520; const H = 300;
  const x = (lng: number) => ((lng - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * W;
  const y = (lat: number) => ((MAP_BOUNDS.north - lat) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * H;
  return <svg className="history-svg-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Incident locations on a simple ASEAN outline map">
    <rect width={W} height={H} className="history-svg-sea"/>
    {[100, 110, 120, 130, 140].map((g) => <line key={`lo${g}`} x1={x(g)} x2={x(g)} y1={0} y2={H} className="history-svg-grid"/>)}
    {[-10, 0, 10, 20].map((g) => <line key={`la${g}`} y1={y(g)} y2={y(g)} x1={0} x2={W} className="history-svg-grid"/>)}
    {cards.map((c) => { const p = point(c); if (!p) return null; const selected = c.id === selectedId;
      return <circle key={c.id} cx={x(p.lng)} cy={y(p.lat)} r={selected ? 7 : 4.5} className={`history-svg-dot hazard-${symbolForDomain(c.domain)}${selected ? ' selected' : ''}`}
        role="button" tabIndex={0} aria-label={`Select ${c.title}`} onClick={() => onSelect(c.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.id); } }}><title>{c.title}</title></circle>; })}
  </svg>;
}

function GoogleHistoryMap({ apiKey, mapId, cards, selectedId, onSelect, onFail }: { apiKey: string; mapId: string; cards: HistoryCard[]; selectedId: string | null; onSelect: (id: string) => void; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  useEffect(() => {
    let disposed = false;
    const timer = window.setTimeout(() => { if (!disposed) onFail(); }, 25_000);
    window.addEventListener('aegis-maps-auth-failure', onFail);
    void loadGoogleMaps(apiKey).then((maps) => {
      if (disposed || !host.current) return;
      clearTimeout(timer);
      const instance = new maps.Map(host.current, {
        center: { lat: 4, lng: 115 }, zoom: 4, minZoom: 3, maxZoom: 12, mapId: mapId || 'DEMO_MAP_ID', mapTypeId: 'roadmap',
        gestureHandling: 'cooperative', streetViewControl: false, mapTypeControl: true, fullscreenControl: false,
      });
      setMap(instance);
    }).catch(() => { if (!disposed) onFail(); });
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('aegis-maps-auth-failure', onFail); host.current?.replaceChildren(); };
  }, [apiKey, mapId, onFail]);

  // Pins are clustered by screen distance and redrawn when the map settles (pan or zoom). The selected pin is never clustered.
  useEffect(() => {
    if (!map) return;
    let markers: google.maps.marker.AdvancedMarkerElement[] = [];
    let listeners: google.maps.MapsEventListener[] = [];
    const byId = new Map(cards.map((c) => [c.id, c]));
    const items = cards.flatMap((c) => { const p = point(c); return p ? [{ id: c.id, lat: p.lat, lng: p.lng }] : []; });
    const clear = () => { listeners.forEach((l) => l.remove()); markers.forEach((m) => { m.map = null; }); markers = []; listeners = []; };
    const render = () => {
      clear();
      const zoom = Math.round(map.getZoom() ?? 4);
      for (const cluster of clusterByGrid(items, zoom, 56, new Set(selectedId ? [selectedId] : []))) {
        if (cluster.ids.length > 1) {
          const el = document.createElement('div');
          el.className = 'history-cluster';
          el.textContent = String(cluster.ids.length);
          el.setAttribute('role', 'button');
          el.setAttribute('aria-label', `${cluster.ids.length} incidents here. Zoom in to see them.`);
          const marker = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: cluster.lat, lng: cluster.lng }, content: el, gmpClickable: true, title: `${cluster.ids.length} incidents here. Click to zoom in.` });
          listeners.push(marker.addListener('click', () => {
            const bounds = new google.maps.LatLngBounds();
            for (const id of cluster.ids) { const c = byId.get(id); const p = c ? point(c) : null; if (p) bounds.extend(p); }
            map.fitBounds(bounds, 90);
          }));
          markers.push(marker);
          continue;
        }
        const c = byId.get(cluster.ids[0]!);
        if (!c) continue;
        const symbol = symbolForDomain(c.domain);
        const el = document.createElement('div');
        el.className = `history-marker hazard-${symbol}${c.id === selectedId ? ' selected' : ''}`;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [k, v] of Object.entries({ viewBox: '-1 -1 26 26', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', hazardIconPaths[symbol]);
        svg.append(path); el.append(svg);
        const marker = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: cluster.lat, lng: cluster.lng }, content: el, gmpClickable: true, title: c.title });
        listeners.push(marker.addListener('click', () => onSelect(c.id)));
        markers.push(marker);
      }
    };
    render();
    const idle = map.addListener('idle', render);
    return () => { idle.remove(); clear(); };
  }, [map, cards, selectedId, onSelect]);

  useEffect(() => {
    if (!map || !selectedId) return;
    const c = cards.find((x) => x.id === selectedId); const p = c ? point(c) : null;
    if (p) map.panTo(p);
  }, [map, selectedId, cards]);
  return <div ref={host} className="history-google-map" aria-label="Google Maps of historical incidents"/>;
}

function YearBars({ cards, fromMs, toMs }: { cards: HistoryCard[]; fromMs: number; toMs: number }) {
  const years = useMemo(() => {
    const counts = new Map<number, number>();
    for (const c of cards) { const y = Number(c.eventStart.slice(0, 4)); counts.set(y, (counts.get(y) ?? 0) + 1); }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [cards]);
  const max = Math.max(1, ...years.map(([, n]) => n));
  return <div className="history-bars" role="img" aria-label={`Incidents per year: ${years.map(([y, n]) => `${y} ${n}`).join(', ')}`}>
    {years.map(([y, n]) => {
      const inside = Date.UTC(y, 11, 31) >= fromMs && Date.UTC(y, 0, 1) <= toMs;
      return <div key={y} className={`history-bar${inside ? ' on' : ''}`} title={`${y}: ${n}`}><span style={{ height: `${Math.max(6, (n / max) * 100)}%` }}/><small>{String(y).slice(2)}</small></div>;
    })}
  </div>;
}

function CardItem({ card, selected, flash = false, onSelect }: { card: HistoryCard; selected: boolean; flash?: boolean; onSelect: (id: string) => void }) {
  const symbol = symbolForDomain(card.domain);
  const located = point(card) !== null;
  const { headline, reference } = splitTitle(card);
  const tiles = factTiles(card);
  const stated = (card.impact?.figures.length ?? 0) > 0;
  const titleId = `hc-title-${card.id}`;
  return <article id={`history-${card.id}`} className={`history-card hc hazard-${symbol}${selected ? ' selected' : ''}${flash ? ' flash' : ''}`} data-card-id={card.id} aria-labelledby={titleId}>
    <header className="hc-head">
      <span className="hc-icon" aria-hidden="true"><HazardIcon hazard={domainName(card.domain)} size={22}/></span>
      <div className="hc-titles">
        <h4 id={titleId} className="hc-title" aria-label={card.title}>{headline}</h4>
        <p className="hc-sub"><time dateTime={card.eventStart}>{whenLabel(card)}</time>{card.place && card.place !== headline ? <> · <span>{card.place}</span></> : null}</p>
      </div>
      {card.rating.value && <span className={`history-rating hc-rating tone-${ratingTone(card.rating.value)}`} title={`${card.rating.scale}: ${card.rating.value}`}>{card.rating.value}</span>}
    </header>

    {tiles.length > 0 && <ul className="hc-facts" aria-label="Key figures">
      {tiles.map((f) => <li key={f.key} className={`hc-fact ${f.tone}`}>
        <span className="hc-fact-value">{f.value}</span>
        <span className="hc-fact-label">{f.label}{f.note ? <small> · {f.note}</small> : null}</span>
      </li>)}
    </ul>}

    <ul className="hc-chips" aria-label="Status">
      {located ? <li className="hc-chip ok">On the map</li> : <li className="hc-chip muted history-nomap" title={card.location.basis}>No map location</li>}
      {stated
        ? <li className="hc-chip ok">{card.provenance.sourceId === 'SRC.WHO.DON' ? 'Counts quoted from the WHO notice' : `Impact stated by ${card.impact!.source.replace(' impact-text product', '')}`}</li>
        : card.domain === 4 ? null   // a haze episode is a measurement: there is no casualty figure to be missing
        : card.domain === 5 ? <li className="hc-chip muted" title="Case counts are on the WHO page; Aegis has not extracted them yet">Case counts: see the WHO page</li>
        : <li className="hc-chip muted" title="Our source for this incident publishes no casualty figures. That is not the same as no impact.">No casualty data from this source</li>}
      {reference && <li className="hc-chip ref">{reference}</li>}
      {card.corroboration.length > 0 && card.domain === 1 && <li className="hc-chip ref">Also reported by GDACS</li>}
    </ul>

    <div className="hc-actions">
      {located ? <button type="button" className="hc-btn primary" onClick={() => onSelect(card.id)}>Show on map</button> : null}
      {card.provenance.sourcePage ? <a className="hc-btn" href={card.provenance.sourcePage} target="_blank" rel="noreferrer">Open source ↗</a> : null}
    </div>

    {card.impact && <details className="hc-disclosure history-quote">
      <summary>Source statement</summary>
      <blockquote>{card.impact.statement}</blockquote>
      <p className="hc-note">{card.impact.note}</p>
    </details>}

    <details className="hc-disclosure history-prov">
      <summary>Provenance and tags</summary>
      <dl className="hc-dl">
        <div><dt>Credit</dt><dd className="history-credit-full">{card.provenance.licence.attribution}</dd></div>
        <div><dt>Source</dt><dd>{card.provenance.sourceName} · {card.provenance.publisher}</dd></div>
        <div><dt>Record</dt><dd>{card.provenance.sourceRecordId}</dd></div>
        <div><dt>Retrieved</dt><dd>{card.provenance.retrievedAt}</dd></div>
        <div><dt>Source updated</dt><dd>{card.provenance.sourceUpdatedAt ?? 'not stated'}</dd></div>
        <div><dt>Location basis</dt><dd>{card.location.basis}</dd></div>
        <div><dt>Licence</dt><dd>{card.provenance.licence.status}</dd></div>
        <div><dt>File SHA-256</dt><dd className="history-hash">{card.provenance.rawSha256}</dd></div>
        <div><dt>Request</dt><dd className="history-hash">{card.provenance.apiUrl}</dd></div>
      </dl>
      <p className="hc-tags">{card.tags.map((x) => <span key={x}>{x}</span>)}</p>
    </details>

    <footer className="hc-foot history-credit">
      <span>{creditLine(card)}</span>
      <span className="hc-retrieved">{retrievedLabel(card)}</span>
    </footer>
  </article>;
}

/**
 * Historical incidents for one hazard domain (or all): a month range control, text search, rating-scale filter, a map and the cards.
 * Loads the whole history once and filters in the browser (contract C0005). Past incidents only; never presented as current.
 */
export function HazardHistory({ domain: initialDomain = null, showDomainChips = false, selectedRangeMs, onSelectedRangeMsChange, selectedCardId }: {
  domain?: number | null;
  showDomainChips?: boolean;
  selectedRangeMs?: HistoryRangeMs;
  onSelectedRangeMsChange?: (range: HistoryRangeMs) => void;
  selectedCardId?: string | null;
}) {
  const [apiKey, setApiKey] = useState(() => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim());
  useEffect(() => {
    if (apiKey) return;
    let active = true;
    void fetch('/public/maps-config', { cache: 'no-store' })
      .then(async response => response.ok ? await response.json() as { mapsApiKey?: unknown } : null)
      .then(config => {
        const key = typeof config?.mapsApiKey === 'string' ? config.mapsApiKey.trim() : '';
        if (active && key) setApiKey(key);
      })
      .catch(() => { /* Keep the outline map available if Maps is not configured. */ });
    return () => { active = false; };
  }, [apiKey]);
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? '';
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState<number | null>(initialDomain);
  const [text, setText] = useState('');
  const [scale, setScale] = useState('');
  const [mapOnly, setMapOnly] = useState(false);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [recentDefault, setRecentDefault] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const mapWrap = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [popupId, setPopupId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const pickRef = useRef<(id: string) => void>(() => undefined);
  const pickFromMap = useCallback((id: string) => pickRef.current(id), []);
  useEffect(() => {
    const onChange = () => { const on = document.fullscreenElement !== null && document.fullscreenElement === mapWrap.current; setFullscreen(on); if (!on) setPopupId(null); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    if (!popupId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopupId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [popupId]);
  const [googleFailed, setGoogleFailed] = useState(false);

  useEffect(() => { setDomain(initialDomain); }, [initialDomain]);
  useEffect(() => { let live = true; loadHistory().then((d) => { if (live) setData(d); }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'History unavailable'); }); return () => { live = false; }; }, []);

  const months = useMemo(() => (data ? monthStarts(data.window.from, new Date(`${data.window.to}T00:00:00Z`)) : []), [data]);
  const latestMonthIndex = Math.max(0, months.length - 1);
  const selectedMonthRange = useMemo<[number, number] | null>(() => {
    if (!selectedRangeMs || months.length === 0) return null;
    return [monthIndexForTime(months, selectedRangeMs[0]), monthIndexForTime(months, selectedRangeMs[1])];
  }, [selectedRangeMs, months]);
  useEffect(() => {
    if (months.length === 0) return;
    if (selectedRangeMs && selectedMonthRange) {
      setRange(selectedMonthRange);
      setRecentDefault(false);
      return;
    }
    const [fromMs] = recentHistoryRange(data!.window);
    setRange([monthIndexForTime(months, fromMs), latestMonthIndex]);
    setRecentDefault(true);
  }, [selectedRangeMs, selectedMonthRange, months, data, latestMonthIndex]);
  const rangeBounds: [number, number] = [0, latestMonthIndex];
  const [fromIdx, toIdx] = range ?? rangeBounds;
  const archiveEndMs = data ? new Date(`${data.window.to}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY;
  const [recentFromMs, recentToMs] = data ? recentHistoryRange(data.window) : [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  const fromMs = selectedRangeMs?.[0] ?? (recentDefault ? recentFromMs : months[fromIdx] ?? Number.NEGATIVE_INFINITY);
  const toMs = selectedRangeMs?.[1] ?? (recentDefault ? recentToMs : months[toIdx] !== undefined ? monthEnd(months[toIdx]!) : Number.POSITIVE_INFINITY);
  const scales = useMemo(() => [...new Set((data?.cards ?? []).filter((c) => domain === null || c.domain === domain).map((c) => c.rating.scale))].filter((s) => s !== 'none'), [data, domain]);
  const inDomain = useMemo(() => (data?.cards ?? []).filter((c) => domain === null || c.domain === domain), [data, domain]);
  const filtered = useMemo(() => filterHistory(data?.cards ?? [], { domain, fromMs, toMs, text, scale, mapOnly }), [data, domain, fromMs, toMs, text, scale, mapOnly]);
  useEffect(() => {
    if (!selectedCardId || !data) return;
    const index = filtered.findIndex(card => card.id === selectedCardId);
    if (index < 0) return;
    setSelected(selectedCardId);
    setShown(current => Math.max(current, index + 1));
    setFlashId(selectedCardId);
  }, [selectedCardId, data, filtered]);
  useEffect(() => {
    if (!selectedCardId) return;
    const frame = requestAnimationFrame(() => document.getElementById(`history-${selectedCardId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedCardId, shown]);
  const onFail = useMemo(() => () => setGoogleFailed(true), []);
  useEffect(() => {
    const selectedIndex = selectedCardId ? filtered.findIndex(card => card.id === selectedCardId) : -1;
    setShown(selectedIndex >= 0 ? Math.max(PAGE, selectedIndex + 1) : PAGE);
  }, [domain, fromMs, toMs, text, scale, mapOnly, selectedCardId, filtered]);

  if (error) return <p className="history-status" role="alert">Past incidents could not be loaded ({error}). The rest of the page still works.</p>;
  if (!data) return <div className="history-status history-skeleton" role="status" aria-label="Loading past incidents"><span/><span/><span/></div>;
  const lastIdx = Math.max(1, months.length - 1);
  const pct = (i: number) => (i / lastIdx) * 100;
  const yearTicks = months.map((ms, i) => ({ ms, i })).filter(({ ms }) => new Date(ms).getUTCMonth() === 0).map(({ ms, i }) => ({ label: String(new Date(ms).getUTCFullYear()), at: pct(i) }));
  const setFrom = (v: number) => {
    const next = Math.max(rangeBounds[0], Math.min(v, toIdx));
    if (onSelectedRangeMsChange) {
      const to = selectedRangeMs?.[1] ?? (recentDefault ? recentToMs : monthEnd(months[toIdx]!));
      onSelectedRangeMsChange([Math.min(months[next]!, to), to]);
    } else {
      setRecentDefault(false);
      setRange([next, toIdx]);
    }
  };
  const setTo = (v: number) => {
    const next = Math.min(rangeBounds[1], Math.max(v, fromIdx));
    if (onSelectedRangeMsChange) {
      const from = selectedRangeMs?.[0] ?? (recentDefault ? recentFromMs : months[fromIdx]!);
      onSelectedRangeMsChange([from, Math.max(from, Math.min(archiveEndMs, monthEnd(months[next]!)))]);
    } else {
      setRecentDefault(false);
      setRange([fromIdx, next]);
    }
  };
  const preset = (monthsBack: number | null) => {
    const [first, last] = rangeBounds;
    const start = monthsBack === null ? first : Math.max(first, last - monthsBack);
    if (onSelectedRangeMsChange) onSelectedRangeMsChange([months[start]!, archiveEndMs]);
    else {
      setRecentDefault(false);
      setRange([start, last]);
    }
  };
  const presetRecent = () => {
    if (onSelectedRangeMsChange) onSelectedRangeMsChange(recentHistoryRange(data.window));
    else {
      setRange([monthIndexForTime(months, recentFromMs), months.length - 1]);
      setRecentDefault(true);
    }
  };
  // A map pin: on the normal page, bring the card into view and highlight it; in full screen, pop the card up over the map.
  pickRef.current = (id: string) => {
    setSelected(id);
    if (document.fullscreenElement !== null && document.fullscreenElement === mapWrap.current) { setPopupId(id); return; }
    const index = filtered.findIndex((c) => c.id === id);
    if (index >= shown) setShown(index + 1);              // the card may sit beyond the first page of the list
    setFlashId(id);
    window.setTimeout(() => setFlashId((current) => (current === id ? null : current)), 2200);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => document.getElementById(`history-${id}`)?.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' }), 60);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void mapWrap.current?.requestFullscreen?.();
  };
  const popupCard = popupId ? filtered.find((c) => c.id === popupId) ?? null : null;
  const useGoogle = apiKey !== '' && !googleFailed;
  const visibleCards = filtered.slice(0, shown);
  // plain computation (not a hook): it sits after the early returns above
  const byYear = new Map<string, HistoryCard[]>();
  for (const c of visibleCards) { const y = c.eventStart.slice(0, 4); byYear.set(y, [...(byYear.get(y) ?? []), c]); }
  const grouped = [...byYear.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));

  return <section className="hazard-history" aria-label="Past incidents" data-card-kind="module" data-card-id="module:hazard-history">
    {showDomainChips && <div className="history-chips" role="group" aria-label="Hazard">
      <button type="button" aria-pressed={domain === null} onClick={() => setDomain(null)}>All hazards</button>
      {[1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} type="button" aria-pressed={domain === n} onClick={() => setDomain(n)}>{domainName(n)}</button>)}
    </div>}
    <div className="history-controls">
      <label className="history-search">
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Place, country, hazard, source…" aria-label="Search past incidents"/></label>
      {scales.length > 1 && <label><span>Rating scale</span><select value={scale} onChange={(e) => setScale(e.target.value)} aria-label="Rating scale"><option value="">All scales</option>{scales.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>}
      <label className="history-check"><input type="checkbox" checked={mapOnly} onChange={(e) => setMapOnly(e.target.checked)}/> Only with a map location</label>
    </div>
    <div className="history-body">
      <div className="history-map-col">
      <div className={`history-map${fullscreen ? ' is-fullscreen' : ''}`} ref={mapWrap}>
        {useGoogle
          ? <GoogleHistoryMap apiKey={apiKey} mapId={mapId} cards={filtered} selectedId={selected} onSelect={pickFromMap} onFail={onFail}/>
          : <SvgMap cards={filtered} selectedId={selected} onSelect={pickFromMap}/>}
        {typeof document !== 'undefined' && document.fullscreenEnabled && <button type="button" className="history-fs-btn" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>}
        {fullscreen && popupCard && <div className="history-popup" role="dialog" aria-label={`Incident details: ${popupCard.title}`}>
          <button type="button" className="history-popup-close" aria-label="Close incident details" onClick={() => setPopupId(null)}>×</button>
          <CardItem card={popupCard} selected onSelect={(id) => setSelected(id)}/>
        </div>}
      </div>
      {(() => { const noPoint = filtered.filter((c) => !point(c)).length; return noPoint > 0 ? <p className="archive-map-note" role="note">{filtered.length} incident{filtered.length === 1 ? '' : 's'} in this view; {filtered.length - noPoint} {filtered.length - noPoint === 1 ? 'has' : 'have'} a map pin. The other {noPoint} {noPoint === 1 ? 'is' : 'are'} listed but not pinned: the source gives no single point for {noPoint === 1 ? 'it' : 'them'} (a storm track, a national outbreak report, or an area). No pin is guessed.</p> : null; })()}
      </div>
      <div className="history-results-column">
      <div className="history-range">
        <YearBars cards={inDomain} fromMs={fromMs} toMs={toMs}/>
        <div className="history-dual">
          <div className="history-dual-labels"><span>From <strong>{monthLabel(fromMs)}</strong></span><span>To <strong>{monthLabel(months[toIdx] ?? fromMs)}</strong></span></div>
          <div className="history-dual-track">
            <span className="history-dual-fill" style={{ left: `${pct(fromIdx)}%`, right: `${100 - pct(toIdx)}%` }}/>
            <input type="range" className={`history-dual-input${fromIdx > lastIdx / 2 ? ' on-top' : ''}`} min={rangeBounds[0]} max={rangeBounds[1]} value={fromIdx} onChange={(e) => setFrom(Number(e.target.value))} aria-label="Show incidents from month"/>
            <input type="range" className={`history-dual-input${fromIdx > lastIdx / 2 ? '' : ' on-top'}`} min={rangeBounds[0]} max={rangeBounds[1]} value={toIdx} onChange={(e) => setTo(Number(e.target.value))} aria-label="Show incidents up to month"/>
          </div>
          <div className="history-dual-ticks" aria-hidden="true">{yearTicks.map((t) => <span key={t.label} style={{ left: `${t.at}%` }}>{t.label}</span>)}</div>
        </div>
        <div className="history-presets">
          <button type="button" onClick={presetRecent}>Last 3 months</button>
          <button type="button" onClick={() => preset(null)}>All years</button>
          <button type="button" onClick={() => preset(35)}>Last 3 years</button>
          <button type="button" onClick={() => preset(11)}>Last 12 months</button>
        </div>
      </div>
      <p className="history-count" role="status" aria-live="polite">{filtered.length} past incident{filtered.length === 1 ? '' : 's'} shown · {filtered.filter((c) => point(c)).length} on the map · {filtered.filter((c) => !point(c)).length} without a map location</p>
      <div className="history-list">
        {filtered.length === 0 ? <div className="history-empty"><strong>No incident matches.</strong><p>Widen the dates, change the hazard, or clear the search.</p>
            <button type="button" className="hc-btn primary" onClick={() => { setText(''); setScale(''); setMapOnly(false); preset(null); }}>Clear filters</button></div>
          : grouped.map(([year, cards]) => <section key={year} className="hc-year-group" aria-label={`${year}, ${cards.length} incidents`}>
            <h3 className="hc-year"><span>{year}</span><small>{cards.length}</small></h3>
            {cards.map((c) => <CardItem key={c.id} card={c} selected={c.id === selected} flash={c.id === flashId} onSelect={(id) => { setSelected(id); document.getElementById(`history-${id}`)?.scrollIntoView({ block: 'nearest' }); }}/>)}
          </section>)}
        {filtered.length > shown && <button type="button" className="ui-button history-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</button>}
      </div>
      </div>
    </div>
    <footer className="history-foot">
      <p>{data.remark}</p>
      <p>{data.credits.join(' · ')}</p>
    </footer>
  </section>;
}
