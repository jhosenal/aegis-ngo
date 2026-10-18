import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../design/tokens.css';
import { useHazardMap } from './seam/provider.js';
import { OverlayCanvas } from './OverlayCanvas.js';
import { HazardAnimationControl } from './HazardAnimationControl.js';
import { SchematicAdapter, type MapAdapter } from './MapAdapter.js';
import { blinkOpacity, describeModel, projectEvents, REDUCED_MOTION_QUERY, type HazardFilter, type LayerEvent } from './model.js';
import { webglAvailable } from '../scene/webgl.js';
import './prototype.css';

const hazardKinds = [
  ['seismic', 'Seismic'], ['hydrological', 'Hydrological'], ['meteorological', 'Meteorological'],
  ['wildfire', 'Wildfire'], ['biological', 'Biological'], ['displacement', 'Displacement'], ['volcanic', 'Volcanic'],
] as const;
const severityNames = { CRITICAL: 'Critical', WARNING: 'Warning', WATCH: 'Watch' } as const;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function SvgEvents({ events, selectedId, onSelect, paused, reducedMotion }: { events: LayerEvent[]; selectedId: string | null; onSelect: (id: string) => void; paused: boolean; reducedMotion: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (paused || reducedMotion) return undefined;
    let frame = 0;
    let last = -Infinity;
    const start = performance.now();
    const animate = (now: number): void => {
      frame = 0;
      if (document.visibilityState === 'hidden') return;
      if (now - last >= 1000 / 30) {
        last = now;
        const seconds = (now - start) / 1000;
        for (const group of svgRef.current?.querySelectorAll<SVGGElement>('.hazard-svg-event') ?? []) {
          const severity = group.dataset.severity;
          const opacity = severity === 'CRITICAL' ? blinkOpacity(seconds) : severity === 'WARNING' ? 0.82 + 0.1 * Math.sin(2 * Math.PI * 0.16 * seconds) : 1;
          group.style.opacity = String(opacity);
        }
      }
      frame = requestAnimationFrame(animate);
    };
    const visibility = (): void => {
      if (document.visibilityState === 'hidden') { if (frame) cancelAnimationFrame(frame); frame = 0; }
      else if (!frame) frame = requestAnimationFrame(animate);
    };
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(animate);
    return () => { if (frame) cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [paused, reducedMotion, events]);
  return <svg ref={svgRef} className="hazard-svg-overlay" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-reduced-motion={reducedMotion ? 'true' : 'false'}>
    {events.map((event) => <g key={event.id} className={`hazard-svg-event severity-${event.severity.toLowerCase()}`} data-event-id={event.id} data-severity={event.severity} data-selected={selectedId === event.id ? 'true' : 'false'} transform={`translate(${event.x} ${event.y})`} onClick={() => onSelect(event.id)}>
      {selectedId === event.id && <circle className="hazard-selected-ring" r={event.radius + 2.5}/>}
      <circle className="hazard-area" r={event.radius}/>
      <circle className="hazard-ring" r={event.radius}/>
      <circle className="hazard-icon-plate" r="2.1"/>
      <image className="hazard-kind-icon" href={`/brand/domains/${event.type}.png`} x="-1.45" y="-1.45" width="2.9" height="2.9" preserveAspectRatio="xMidYMid meet"/>
    </g>)}
  </svg>;
}

function SplitDescription({ description }: { description: string }) {
  const [label, kind, severity, age, note] = description.split(' | ');
  return <span className="hazard-row-copy"><strong>{label}</strong><span className="hazard-row-tags"><span>{kind}</span><span>{severity}</span><span>{age}</span></span><span className="hazard-row-note">{note}</span></span>;
}

export function HazardMapRoute() {
  const state = useHazardMap();
  const stageRef = useRef<HTMLDivElement>(null);
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  const [filter, setFilter] = useState<HazardFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [paused, setPaused] = useState(prefersReducedMotion);
  const [compact, setCompact] = useState(() => window.innerWidth <= 800);
  const [smallPhone, setSmallPhone] = useState(() => window.innerWidth <= 370);
  const [renderer, setRenderer] = useState<'webgl' | 'svg'>(() => new URLSearchParams(window.location.search).get('renderer') === 'svg' || !webglAvailable() ? 'svg' : 'webgl');
  const data = state.status === 'ready' ? state.data : null;

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = (): void => { setReduced(media.matches); if (media.matches) setPaused(true); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const update = (): void => { setCompact(window.innerWidth <= 800); setSmallPhone(window.innerWidth <= 370); };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const element = stageRef.current;
    if (!element || !data) return undefined;
    const schematic = new SchematicAdapter(element);
    setAdapter(schematic);
    return () => setAdapter(null);
  }, [data]);

  const model = useMemo(() => data ? projectEvents(data, filter) : null, [data, filter]);
  const descriptions = useMemo(() => model ? describeModel(model) : [], [model]);
  const visibleEvents = model?.events ?? [];
  const selectedEvent = visibleEvents.find((event) => event.id === selectedId) ?? null;
  const selectEvent = useCallback((id: string) => setSelectedId(id), []);
  const svgFallback = useCallback(() => setRenderer('svg'), []);

  return <main className="hazard-map-root" data-compact={compact ? 'true' : 'false'} data-small-phone={smallPhone ? 'true' : 'false'} data-paused={paused || reduced ? 'true' : 'false'} data-reduced-motion={reduced ? 'true' : 'false'}>
    <div className="hazard-map-synthetic-strip" role="note"><span>{data?.syntheticLabel ?? 'PROTOTYPE. Synthetic events on a schematic frame.'}</span><strong className="hazard-map-prototype-badge">PROTOTYPE</strong></div>
    <header className="hazard-map-page-header"><h1>Hazard map prototype</h1><p>Fictional event areas on a schematic frame.</p></header>
    {state.status === 'loading' && <p className="hazard-map-state" role="status">Loading synthetic hazard events…</p>}
    {state.status === 'error' && <p className="hazard-map-state" role="alert">The synthetic hazard map could not be loaded. Try refreshing the page.</p>}
    {data && model && <div className="hazard-map-layout">
      <section className="hazard-map-stage-column" aria-labelledby="hazard-map-frame-title">
        <div className="hazard-map-frame-heading"><h2 id="hazard-map-frame-title">{data.frame.name}</h2><p>{data.frame.note}</p></div>
        <div ref={stageRef} className="hazard-map-stage" data-testid="hazard-map-stage" data-renderer={renderer} data-paused={paused || reduced ? 'true' : 'false'} data-events={visibleEvents.length} data-selected-event={selectedId ?? ''}>
          <svg className="hazard-map-basemap" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Schematic land and water frame; not a geographic map">
            <rect className="hazard-map-ground" width="100" height="100"/>
            <path className="hazard-map-grid" d="M10 0v100M20 0v100M30 0v100M40 0v100M50 0v100M60 0v100M70 0v100M80 0v100M90 0v100M0 10h100M0 20h100M0 30h100M0 40h100M0 50h100M0 60h100M0 70h100M0 80h100M0 90h100"/>
            <path className="hazard-map-land" d="M5 19 18 8l16 4 10-5 16 7 18-6 17 9-3 18 6 11-8 13-4 22-17 8-14-5-16 8-13-8-16 2-8-13 4-16-7-13 9-11Z"/>
            <path className="hazard-map-water" d="M9 69c14-12 17-9 24-17s13-2 20-10 13-2 19-10 10-4 19-11M14 90c10-6 16-3 22-9s12-2 18-9 13-3 19-10 12-4 18-10"/>
            <path className="hazard-map-region" d="M17 24 35 15l17 5 13-7 18 12-2 17 5 11-9 17-15 8-16-4-14 7-14-10 1-15-8-12 6-20Z"/>
          </svg>
          {renderer === 'svg' ? <SvgEvents events={visibleEvents} selectedId={selectedId} onSelect={selectEvent} paused={paused || reduced} reducedMotion={reduced}/> : adapter && <OverlayCanvas adapter={adapter} model={model} selectedId={selectedId} paused={paused || reduced} reducedMotion={reduced} onSelect={selectEvent} onFallback={svgFallback}/>}
        </div>
        <p className="hazard-map-frame-note">The drawn region is fictional. It does not represent real locations or active incidents.</p>
      </section>
      <aside className="hazard-map-side-column" aria-label="Map controls and events">
        <div className="hazard-map-controls"><h2>Hazard types</h2><div className="hazard-map-filters" aria-label="Filter events by hazard type">
          <button type="button" className="hazard-filter-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}><span>All</span></button>
          {hazardKinds.map(([kind, label]) => <button key={kind} type="button" className="hazard-filter-chip" aria-pressed={filter === kind} onClick={() => setFilter(kind)}><img src={`/brand/domains/${kind}.png`} alt=""/><span>{label}</span></button>)}
        </div><HazardAnimationControl paused={paused} reducedMotion={reduced} onToggle={() => setPaused((value) => !value)}/></div>
        <div className="hazard-map-legends"><h2>Legend</h2><ul className="hazard-map-legend-severity">
          <li><span className="hazard-legend-ring ring-critical" aria-hidden="true"/><strong>Critical</strong><span>Solid ring · softly blinks</span></li>
          <li><span className="hazard-legend-ring ring-warning" aria-hidden="true"/><strong>Warning</strong><span>Dashed ring · gentle pulse</span></li>
          <li><span className="hazard-legend-ring ring-watch" aria-hidden="true"/><strong>Watch</strong><span>Dotted ring · steady</span></li>
        </ul><h3>Hazard kinds</h3><ul className="hazard-map-legend-kinds">{hazardKinds.map(([kind, label]) => <li key={kind}><img src={`/brand/domains/${kind}.png`} alt=""/><span>{label}</span></li>)}</ul></div>
        <section className="hazard-map-events" aria-labelledby="hazard-map-events-title"><h2 id="hazard-map-events-title">{filter === 'all' ? 'Synthetic events' : `${hazardKinds.find(([kind]) => kind === filter)?.[1]} events`}</h2>
          {descriptions.length === 0 ? <p className="hazard-map-empty">No events match this hazard type.</p> : <div className="hazard-map-event-list">{descriptions.map((description, index) => {
            const event = visibleEvents[index]!;
            return <button key={event.id} type="button" className="hazard-map-event-row" aria-label={description} data-selected={event.id === selectedId ? 'true' : 'false'} onClick={() => selectEvent(event.id)}><img src={`/brand/domains/${event.type}.png`} alt=""/><SplitDescription description={description}/></button>;
          })}</div>}
        </section>
        {selectedEvent && <section className="hazard-map-detail" aria-labelledby="hazard-map-detail-title" data-testid="hazard-map-detail"><div><h2 id="hazard-map-detail-title">{selectedEvent.label}</h2><button type="button" className="hazard-detail-close" aria-label="Close event details" onClick={() => setSelectedId(null)}>Close</button></div><p>{selectedEvent.type} · {severityNames[selectedEvent.severity]}</p><p>{selectedEvent.hoursAgo} hours ago</p><p>{selectedEvent.note}</p></section>}
      </aside>
    </div>}
  </main>;
}
