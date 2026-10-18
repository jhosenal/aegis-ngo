import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import '../design/tokens.css';
import { Divider } from '../components/Divider.js';
import { Sheet } from '../components/Sheet.js';
import { formatCount, type Overview } from '../../../src/overview/contract.js';
import { useOverview } from './seam/provider.js';
import { answerAssist } from './lib/assist.js';
import { formatAbsolute, priorityChip, relativeTime } from './lib/format.js';
import './overview.css';

type TabId = 'overview' | 'report' | 'people' | 'resources' | 'evidence' | 'updates';
type Message = { role: 'assistant' | 'user'; text: string; title?: string; paragraphs?: string[]; items?: string[]; time: string; builtFromPage?: boolean };
const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'report', label: 'Report incident' }, { id: 'people', label: 'People at risk' },
  { id: 'resources', label: 'Resources' }, { id: 'evidence', label: 'Evidence' }, { id: 'updates', label: 'Updates' },
];
const navigation = [
  ['Home', '⌂', 'overview'], ['Incidents', '△', 'incidents'], ['People', '♙', 'people'], ['Resources', '⬡', 'resources'],
  ['Reports', '▤', 'reports'], ['Maps', '◇', 'maps'], ['Aegis Assist', '✧', 'assist'],
  ['Organization', '▦', 'organization'], ['Settings', '⚙', 'settings'],
] as const;
const promoDomains = ['seismic', 'hydrological', 'meteorological', 'wildfire', 'biological', 'displacement', 'volcanic'] as const;
const bandLabels: Record<string, string> = { GOOD: 'Good', MODERATE: 'Moderate', UNHEALTHY_SENSITIVE: 'Unhealthy for sensitive groups', UNHEALTHY: 'Unhealthy', VERY_UNHEALTHY: 'Very unhealthy', HAZARDOUS: 'Hazardous', UNKNOWN: 'Unknown' };

function Glyph({ name, size = 20 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const paths: Record<string, ReactNode> = {
    sparkle: <><path d="M12 2.8 14.4 9.6 21.2 12 14.4 14.4 12 21.2 9.6 14.4 2.8 12 9.6 9.6 12 2.8Z"/><path d="m19 2 .8 2.2L22 5l-2.2.8L19 8l-.8-2.2L16 5l2.2-.8L19 2Z"/></>,
    menu: <><path d="M3 6h18M3 12h18M3 18h18"/></>, close: <><path d="m5 5 14 14M19 5 5 19"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4 1.8c-1 .8-1.7 1.2-1.7 2.7M12 17h.01"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    air: <><path d="M3 7h12a3 3 0 1 0-3-3M3 12h17a2 2 0 1 1-2 2M3 17h10a3 3 0 1 1-3 3"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"/></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    box: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z"/><path d="m3.5 7.5 8.5 5 8.5-5M12 12.5V22"/></>,
    send: <><path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 5-5"/></>,
    child: <><circle cx="12" cy="6" r="3"/><path d="M6 21v-4a6 6 0 0 1 12 0v4M8 13l-2-2m10 2 2-2"/></>,
    older: <><circle cx="12" cy="5" r="3"/><path d="M8 11h8l2 10M8 11l-2 10m3-6h6M11 21l1-7 3 7"/></>,
    respiratory: <><path d="M12 4v7m0 0c-2-4-5-5-6-2-2 5-1 9 3 9 2 0 3-2 3-5m0-2c2-4 5-5 6-2 2 5 1 9-3 9-2 0-3-2-3-5"/></>,
    general: <><circle cx="12" cy="7" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>,
    masks: <><path d="M4 9c5-3 11-3 16 0v6c-5 4-11 4-16 0V9Z"/><path d="M4 10 2 8m18 2 2-2M8 12h.01M16 12h.01"/></>,
    purifier: <><path d="M5 3v18M12 3v18M19 3v18M3 7h4m3 5h4m3 5h4"/></>,
    medicine: <><path d="M12 3 21 7v5c0 5-4 8-9 10-5-2-9-5-9-10V7l9-4Z"/><path d="M12 8v8m-4-4h8"/></>,
    update: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg {...common}>{paths[name] ?? <circle cx="12" cy="12" r="8"/>}</svg>;
}

function Sparkline({ values, bars = false }: { values: number[]; bars?: boolean }) {
  const max = Math.max(1, ...values);
  return <svg className={bars ? 'sparkline sparkline-bars' : 'sparkline'} viewBox="0 0 84 42" aria-hidden="true">
    {bars ? values.map((value, index) => <rect key={index} x={8 + index * (68 / values.length)} y={38 - value / max * 34} width={Math.max(3, 42 / values.length)} height={value / max * 34} rx="2"/>)
      : <polyline points={values.map((value, index) => `${4 + index * (76 / Math.max(values.length - 1, 1))},${38 - value / max * 32}`).join(' ')}/>}
  </svg>;
}

function shortAirQualityTime(value: string | null): string {
  return formatAbsolute(value).replace(/\s+\d{4},/, ',').replace(/\s+\(UTC[^)]+\)/, '');
}

type MapArea = Overview['map']['areas'][number];
const bandColors: Record<string, string> = {
  GOOD: 'var(--aeg-band-good)', MODERATE: 'var(--aeg-band-moderate)', UNHEALTHY_SENSITIVE: 'var(--aeg-band-sensitive)',
  UNHEALTHY: 'var(--aeg-band-unhealthy)', VERY_UNHEALTHY: 'var(--aeg-band-very-unhealthy)', HAZARDOUS: 'var(--aeg-band-hazardous)', UNKNOWN: 'var(--aeg-ink-muted)',
};

function Marker({ area, active, onActivate, onClear }: { area: MapArea; active: boolean; onActivate: () => void; onClear: () => void }) {
  const position = { x: area.x > 70 ? -12 : 3, y: area.y > 60 ? -16 : 2 };
  const unknown = area.aqi === null || area.band === 'UNKNOWN';
  return <g className="map-marker" data-active={active ? 'true' : 'false'} transform={`translate(${area.x} ${area.y})`} role="img" aria-label={`${area.name}, AQI ${formatCount(area.aqi)}, ${bandLabels[area.band] ?? 'Unknown'}`} tabIndex={0} onFocus={onActivate} onBlur={onClear} onClick={onActivate} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClear(); } }}>
    <title>{area.name}, AQI {formatCount(area.aqi)}, {bandLabels[area.band] ?? 'Unknown'}</title>
    {active && <circle className="marker-halo" r="7.4" fill="none" stroke="var(--aeg-primary-text)" strokeWidth="1.1"/>}
    <circle className="marker-dot" r={active ? 4.2 : 3.1} fill={unknown ? 'var(--aeg-ink-muted)' : bandColors[area.band] ?? 'var(--aeg-ink-muted)'} stroke="var(--aeg-surface)" strokeWidth="0.8"/>
    <rect className="marker-number-bg" x={position.x} y={position.y} width="9.5" height="5.2" rx="1.1" fill={unknown ? 'var(--aeg-tile-bg)' : 'var(--aeg-surface)'} opacity="0.96"/>
    <text x={position.x + 4.75} y={position.y + 3.8} textAnchor="middle" className="map-aqi-label">{unknown ? '?' : formatCount(area.aqi)}</text>
  </g>;
}

function AirMap({ data, onComing }: { data: Overview; onComing: (name: string) => void }) {
  const [layers, setLayers] = useState(() => Object.fromEntries(data.map.layers.map((layer) => [layer.id, layer.defaultOn])) as Record<string, boolean>);
  const [zoom, setZoom] = useState(1);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const sortedAreas = useMemo(() => [...data.map.areas].sort((left, right) => (right.aqi ?? Number.NEGATIVE_INFINITY) - (left.aqi ?? Number.NEGATIVE_INFINITY)), [data.map.areas]);
  const mapViewBox = `${50 - 50 / zoom} ${50 - 50 / zoom} ${100 / zoom} ${100 / zoom}`;
  const activeArea = sortedAreas.find((area) => area.id === activeMarkerId) ?? null;
  const toggle = (id: string) => setLayers((current) => ({ ...current, [id]: !current[id] }));
  return <section className="overview-card map-card" aria-labelledby="map-title">
    <div className="section-heading"><h2 id="map-title">Affected area</h2><button className="text-button" onClick={() => onComing('Full map')}>View full map</button></div>
    <div className="map-layer-chips" aria-label="Map layers">{data.map.layers.map((layer) => <button key={layer.id} type="button" aria-pressed={Boolean(layers[layer.id])} onClick={() => toggle(layer.id)}><span aria-hidden="true">{layers[layer.id] ? '✓' : '＋'}</span>{layer.label}{layer.id === 'haze-extent' ? ' (MODIS)' : ''}</button>)}</div>
    <div className="map-layout"><div className="map-stage">
      <svg className="schematic-map" viewBox={mapViewBox} role="img" aria-label="Schematic map showing affected communities and air quality">
        <rect width="100" height="100" className="map-ground"/>
        <path d="M0 15 16 4 31 9 44 2 61 10 75 1 100 11V100H0Z" className="map-terrain"/>
        <path d="M-5 70 14 57 23 65 37 49 51 55 66 38 84 45 102 30M-5 21 16 34 31 20 49 29 69 15 86 24 104 10M12 100 21 81 34 87 48 72 65 79 80 61 100 69" className="map-river"/>
        {layers['haze-extent'] && <g className="haze-layer" aria-label="Haze extent">
          <ellipse cx="48" cy="43" rx="34" ry="27"/><ellipse cx="57" cy="38" rx="22" ry="19"/><ellipse cx="37" cy="51" rx="20" ry="16"/>
        </g>}
        {layers.boundary && <path d="M17 24 35 17 49 22 62 17 82 30 78 50 84 66 66 81 47 77 32 84 19 69 24 51 14 40Z" className="map-boundary"/>}
        {layers['ngo-sites'] && <g className="map-sites" aria-label="NGO site locations were not supplied"><title>NGO site locations not supplied</title><path d="M9 9h82v10H9z"/></g>}
        {layers['air-quality'] && layers.communities && data.map.areas.map((area) => <Marker key={area.id} area={area} active={activeMarkerId === area.id} onActivate={() => setActiveMarkerId(area.id)} onClear={() => setActiveMarkerId(null)}/>)}
    </svg>
      {sortedAreas.length === 0 && <div className="map-empty-state"><Glyph name="pin" size={22}/><span>No affected communities in this data.</span></div>}
      <div className="map-controls"><button aria-label="Zoom in" title="Zoom in" onClick={() => setZoom((n) => Math.min(2, n * 1.2))}>+</button><button aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((n) => Math.max(1, n / 1.2))}>−</button><button aria-label="Reset map view" title="Reset map view" onClick={() => setZoom(1)}><Glyph name="pin" size={18}/></button></div>
    </div>
    <div className={`map-tooltip-slot${activeArea ? ' has-tooltip' : ''}`} aria-live="polite">{activeArea && <span className="map-tooltip" role="tooltip">{activeArea.name} · AQI {formatCount(activeArea.aqi)}</span>}</div>
    <ul className="map-legend" aria-label="Communities by air quality">{sortedAreas.map((area) => <li key={area.id}><button className="map-legend-row" type="button" data-active={activeMarkerId === area.id ? 'true' : 'false'} aria-pressed={activeMarkerId === area.id} onFocus={() => setActiveMarkerId(area.id)} onBlur={() => setActiveMarkerId(null)} onPointerEnter={() => setActiveMarkerId(area.id)} onPointerLeave={() => setActiveMarkerId(null)} onClick={() => setActiveMarkerId(area.id)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setActiveMarkerId(null); } }}><span className={`legend-swatch${area.band === 'UNKNOWN' ? ' legend-swatch-unknown' : ''}`} style={{ background: bandColors[area.band] ?? 'var(--aeg-ink-muted)' }} aria-hidden="true"/><span className="legend-details">{area.band !== 'UNKNOWN' && <span className="legend-band">{bandLabels[area.band] ?? 'Unknown'}</span>}<span className="legend-community">{area.name}<span aria-hidden="true"> · </span>{formatCount(area.aqi)}</span></span></button></li>)}</ul></div>
    <p className="map-note">{data.map.note}</p>
  </section>;
}

function SectionEmpty({ glyph, message }: { glyph: string; message: string }) {
  return <div className="section-empty"><Glyph name={glyph} size={22}/><span>{message}</span></div>;
}

function GroupRows({ data, onViewAll }: { data: Overview; onViewAll?: () => void }) {
  const icons: Record<string, string> = { child: 'child', older: 'older', respiratory: 'respiratory', general: 'general' };
  return <section className="overview-card" id="people-section" aria-labelledby="people-title"><div className="section-heading"><h2 id="people-title">People at risk</h2>{onViewAll && <button className="text-button" onClick={onViewAll}>View all</button>}</div>
    {data.groups.length === 0 ? <SectionEmpty glyph="people" message="No group data."/> : <div className="group-list">{data.groups.map((group) => <article className="group-row" key={group.id}>
      <span className="group-glyph"><Glyph name={icons[group.icon] ?? 'general'} size={24}/></span><span className="group-label">{group.label}</span><strong className="group-count">{formatCount(group.count)}</strong>
      <span className="progress" role="img" aria-label={`${group.sharePercent === null ? 'share unknown' : `${group.sharePercent}%`} of people at risk`}><span style={{ width: `${group.sharePercent ?? 0}%` }}/></span><span className="group-percent">{group.sharePercent === null ? 'share unknown' : `${group.sharePercent}%`}</span>
    </article>)}</div>}
  </section>;
}

function ShortfallRows({ data, onComing }: { data: Overview; onComing?: () => void }) {
  const icons: Record<string, string> = { 'N95 masks': 'masks', 'Air purifiers': 'purifier', 'Respiratory medicine': 'medicine' };
  return <section className="overview-card" id="resources-section" aria-labelledby="resources-title"><div className="section-heading"><h2 id="resources-title">Resource shortfall</h2>{onComing && <button className="text-button" onClick={onComing}>View all</button>}</div>
    {data.shortfall.length === 0 ? <SectionEmpty glyph="box" message="No resource shortfall recorded."/> : <div className="shortfall-table-wrap"><table className="shortfall-table"><thead><tr><th scope="col">Item</th><th scope="col">Type</th><th scope="col">Requested</th><th scope="col">Available</th><th scope="col">Shortfall</th><th scope="col">Priority</th></tr></thead>
      <tbody>{data.shortfall.map((row) => { const info = priorityChip(row.priority); return <tr key={row.id}>
        <th scope="row"><span className="item-name"><Glyph name={icons[row.item] ?? 'box'} size={19}/>{row.item}</span><span className="mobile-resource-type">{row.type}</span></th><td>{row.type}</td><td>{formatCount(row.requested)}</td><td>{formatCount(row.available)}</td><td className={row.shortfall !== null && row.shortfall > 0 ? 'shortfall-critical' : ''}>{formatCount(row.shortfall)}</td>
        <td><span className={`priority-chip priority-${info.className}`}>{info.label}</span><span className="mobile-resource-quantity">{formatCount(row.available)} / {formatCount(row.requested)}</span><span className="resource-progress"><span style={{ width: `${row.requested && row.available !== null ? Math.min(100, row.available / row.requested * 100) : 0}%` }}/></span></td>
      </tr>; })}</tbody></table></div>}
  </section>;
}

function UpdateRows({ data, onComing }: { data: Overview; onComing?: () => void }) {
  return <section className="overview-card" id="updates-section" aria-labelledby="updates-title"><div className="section-heading"><h2 id="updates-title">Recent updates</h2>{onComing && <button className="text-button" onClick={onComing}>View all</button>}</div>
    {data.updates.length === 0 ? <SectionEmpty glyph="update" message="No updates yet."/> : <ol className="updates-list">{data.updates.map((update, index) => <li key={update.id}><span className={`timeline-dot ${index === 0 ? 'timeline-dot-current' : ''}`} aria-hidden="true"/><time dateTime={update.at}>{relativeTime(update.at, data.generatedAt)}</time><p>{update.text}</p></li>)}</ol>}
  </section>;
}

function OverviewBody({ data, onComing, onTab }: { data: Overview; onComing: (name: string) => void; onTab: (tab: TabId) => void }) {
  const kpis = data.kpis;
  const tag = (value: string) => value === 'UNKNOWN' ? 'Unknown' : value;
  return <>
    <div className="kpi-grid" aria-label="Incident indicators">
      <article className={`overview-card kpi-card${kpis.airQuality.value === null ? ' kpi-unknown' : ''}`}><small className="kpi-tag">{tag(kpis.airQuality.tag)}</small><span className="kpi-icon"><Glyph name="air" size={25}/></span><div className="kpi-copy"><h2>Air Quality (PM2.5)</h2><div className="kpi-main"><strong>{formatCount(kpis.airQuality.value)}</strong><span className={`band-chip ${kpis.airQuality.band === 'UNKNOWN' ? 'band-unknown' : `band-${kpis.airQuality.band.toLowerCase().replaceAll('_', '-')}` }`}>{bandLabels[kpis.airQuality.band]}</span></div><small title={`${kpis.airQuality.scale} \u00b7 ${formatAbsolute(kpis.airQuality.asOf)}`} aria-label={`${kpis.airQuality.scale} · ${formatAbsolute(kpis.airQuality.asOf)}`}>{kpis.airQuality.scale}{' · '}{shortAirQualityTime(kpis.airQuality.asOf)}</small></div>{kpis.airQuality.trend.length > 0 && <Sparkline values={kpis.airQuality.trend} bars/>}</article>
      <article className={`overview-card kpi-card${kpis.peopleAtRisk.total === null ? ' kpi-unknown' : ''}`}><small className="kpi-tag">{tag(kpis.peopleAtRisk.tag)}</small><span className="kpi-icon"><Glyph name="people" size={25}/></span><div className="kpi-copy"><h2>People at risk</h2><div className="kpi-main"><strong>{formatCount(kpis.peopleAtRisk.total)}</strong>{kpis.peopleAtRisk.changePercent !== null && <span className="change-chip">? {formatCount(kpis.peopleAtRisk.changePercent)}%</span>}</div><small>Across {formatCount(kpis.peopleAtRisk.communities)} affected communities</small></div>{kpis.peopleAtRisk.trend.length > 0 && <Sparkline values={kpis.peopleAtRisk.trend}/>}</article>
      <article className={`overview-card kpi-card${kpis.affectedAreas.count === null ? ' kpi-unknown' : ''}`}><small className="kpi-tag">{tag(kpis.affectedAreas.tag)}</small><span className="kpi-icon"><Glyph name="pin" size={25}/></span><div className="kpi-copy"><h2>Affected areas</h2><div className="kpi-main"><strong>{formatCount(kpis.affectedAreas.count)}</strong></div><small>{kpis.affectedAreas.unit}</small></div>{kpis.affectedAreas.trend.length > 0 && <Sparkline values={kpis.affectedAreas.trend} bars/>}</article>
      <article className={`overview-card kpi-card${kpis.resourceShortfall.criticalItems === null ? ' kpi-unknown' : ''}`}><small className="kpi-tag">{tag(kpis.resourceShortfall.tag)}</small><span className="kpi-icon"><Glyph name="box" size={25}/></span><div className="kpi-copy"><h2>Resource shortfall</h2><div className="kpi-main"><strong>{formatCount(kpis.resourceShortfall.criticalItems)}</strong><span className="kpi-detail">Critical items</span></div>{kpis.resourceShortfall.actionNeeded && <span className="action-chip">! &nbsp;Action needed</span>}</div></article>
    </div>
    <div className="content-grid"><AirMap data={data} onComing={onComing}/><GroupRows data={data} onViewAll={() => onTab('people')}/><ShortfallRows data={data} onComing={() => onTab('resources')}/><UpdateRows data={data} onComing={() => onTab('updates')}/></div>
  </>;
}

function LoadingOverview() {
  return <main className="overview-state-main"><div className="overview-skeleton" role="status"><span className="visually-hidden">Loading the overview</span><div className="skeleton-title"/><div className="skeleton-kpis">{[0, 1, 2, 3].map((item) => <div className="skeleton-card" key={item}/>)}</div><div className="skeleton-content"><div className="skeleton-card"/><div className="skeleton-card"/></div><span className="skeleton-visible-label" aria-hidden="true">Loading the overview</span></div></main>;
}

function ErrorOverview({ onRetry }: { onRetry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className="overview-state-main"><section className="overview-card overview-error" aria-labelledby="overview-error-title"><span className="coming-mark"><Glyph name="help" size={24}/></span><h1 id="overview-error-title" ref={heading} tabIndex={-1}>The overview could not be loaded</h1><p>Please try again in a moment.</p><button className="primary-button" onClick={onRetry}>Try again</button></section></main>;
}

function AssistConversation({ data, mobile = false }: { data: Overview; mobile?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: 'I can help you analyse this haze incident, extract key information, draft reports, and suggest next steps. How can I help?', time: formatAbsolute(data.generatedAt), builtFromPage: false }]);
  const [input, setInput] = useState('');
  const [live, setLive] = useState('');
  function ask(value: string, displayText = value): void {
    if (!value.trim()) return;
    const answer = answerAssist(value, data);
    const stamp = formatAbsolute(data.generatedAt);
    setMessages((current) => [...current, { role: 'user', text: displayText, time: stamp }, { role: 'assistant', text: '', title: answer.title, paragraphs: answer.paragraphs, items: answer.items, time: stamp }]);
    setLive(answer.title ?? answer.paragraphs.join(' ')); setInput('');
  }
  return <div className={`assist-content${mobile ? ' assist-content-mobile' : ''}`}>
    <div className="quick-actions">{data.assist.quickActions.map((action, index) => <button key={action.id} onClick={() => ask(action.id, action.label)}><Glyph name={['air', 'update', 'people', 'box'][index] ?? 'sparkle'} size={18}/>{action.label}</button>)}</div>
    <div className="conversation" aria-label="Assist conversation">{messages.map((message, index) => <article className={`message message-${message.role}`} key={index}>
      {message.role === 'assistant' && <span className="message-glyph"><Glyph name="sparkle" size={18}/></span>}<div className="message-body">{message.title && <h3>{message.title}</h3>}{message.text && <p>{message.text}</p>}{message.paragraphs?.map((paragraph, i) => <p key={i}>{paragraph}</p>)}{message.items && <ol>{message.items.map((item, i) => <li key={i}>{item}</li>)}</ol>}{message.role === 'assistant' && message.builtFromPage !== false && <small>Built from this page&apos;s data</small>}<time>{message.time}</time></div>
    </article>)}</div>
    <div className="assist-suggestions">{data.assist.suggestions.map((item) => <button key={item.id} onClick={() => ask(item.id, item.label)}>{item.label}</button>)}</div>
    <form className="assist-form" onSubmit={(event) => { event.preventDefault(); ask(input); }}><label className="visually-hidden" htmlFor={mobile ? 'assist-input-mobile' : 'assist-input'}>Ask a question or choose an action</label><input id={mobile ? 'assist-input-mobile' : 'assist-input'} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a question or choose an action..."/><button className="send-button" aria-label="Send question"><Glyph name="send" size={18}/></button></form>
    <p className="assist-footnote">ⓘ &nbsp;{data.assist.footnote}</p><div className="visually-hidden" aria-live="polite">{live}</div>
  </div>;
}

function ComingPanel({ name, onBack }: { name: string; onBack: () => void }) {
  return <section className="overview-card coming-panel" aria-labelledby="coming-title"><span className="coming-mark"><Glyph name="sparkle" size={26}/></span><h2 id="coming-title">{name}</h2><p>This section is not built in this preview.</p><button className="primary-button" onClick={onBack}>Back to overview</button></section>;
}

function Navigation({ onNavigate, onComing, mobile = false, onClose }: { onNavigate: (id: string) => void; onComing: (name: string) => void; mobile?: boolean; onClose?: () => void }) {
  return <nav className={`overview-nav${mobile ? ' overview-nav-drawer' : ''}`} aria-label="Main navigation">
    <div className="nav-items">{navigation.map(([label, icon, id], index) => <div className={index === 7 ? 'nav-divider-before' : ''} key={id}>
      {id === 'assist' ? <a className="nav-link" href="/assist" onClick={onClose}><Glyph name="sparkle" size={19}/><span>{label}</span><span className="preview-chip">Preview</span></a>
        : <button className={`nav-link${id === 'overview' ? ' nav-active' : ''}`} onClick={() => { if (id === 'overview') onNavigate('overview'); else onComing(label); onClose?.(); }}><span className="nav-symbol" aria-hidden="true">{icon}</span><span>{label}</span></button>}
    </div>)}</div>
    <aside className="ngo-promo"><div className="ngo-promo-icons" aria-hidden="true">{promoDomains.map((domain) => <img key={domain} src={`/brand/domains/${domain}.png`} alt=""/>)}</div><strong>Aegis for NGOs</strong><p>One engine. Seven hazards. One rule.</p><a href="/domains">Learn more <span aria-hidden="true">›</span></a></aside>
  </nav>;
}

export function OverviewRoute() {
  const state = useOverview();
  const [tab, setTab] = useState<TabId>('overview');
  const [assistOpen, setAssistOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [coming, setComing] = useState<string | null>(null);
  const [split, setSplit] = useState(66.67);
  const mobileDock = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const tabsScroller = useRef<HTMLDivElement>(null);
  const closeAssist = useCallback(() => setAssistOpen(false), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useEffect(() => { if (!drawerOpen) return; const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; const nav = document.querySelector<HTMLElement>('.overview-nav-drawer'); const targets = () => nav ? [...nav.querySelectorAll<HTMLElement>('button,a[href]')] : []; targets()[0]?.focus();
    const handler = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { closeDrawer(); return; } if (event.key === 'Tab') { const items = targets(); const first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } };
    document.addEventListener('keydown', handler); return () => { document.removeEventListener('keydown', handler); (previous ?? menuButton.current)?.focus(); };
  }, [drawerOpen, closeDrawer]);

  const data = state.status === 'ready' ? state.data : null;
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => { if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return; event.preventDefault(); const step = event.key === 'ArrowRight' ? 1 : -1; const next = (index + step + tabs.length) % tabs.length; setTab(tabs[next]!.id); document.getElementById(`overview-tab-${tabs[next]!.id}`)?.focus(); };
  const showComing = (name: string) => { setComing(name); setTab('overview'); };
  const setCurrent = (id: string) => { setComing(null); setTab(id as TabId); };
  const mainStyle = useMemo(() => ({ gridTemplateColumns: `${split}% 8px minmax(320px, 1fr)` }), [split]);
  const currentTab = tabs.find((item) => item.id === tab)!;
  return <div className="overview-root">
    <div className="synthetic-strip" role="note">{data?.syntheticLabel ?? 'Synthetic demonstration data. The preview is loading or unavailable.'}</div>
    {data && <button ref={mobileDock} className="assist-dock" aria-label="Open AI Assist" onClick={() => setAssistOpen(true)}><Glyph name="sparkle" size={19}/><span>AI Assist</span></button>}
    <header className="overview-header"><button ref={menuButton} className="icon-button menu-trigger" aria-label="Open navigation" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Glyph name="menu"/></button><div className="overview-brand"><img src="/brand/aegis-ngo-logo.webp" alt="Aegis NGO"/><span><strong>A SAFER TOMORROW, TOGETHER</strong><small>AI FOR PEOPLE. EVIDENCE FOR ACTION.</small></span></div>
      <label className="overview-search"><Glyph name="search"/><input aria-label="Search incidents, people, places" placeholder="Search incidents, people, places..." disabled title="Coming: search is not built in this preview."/><span className="visually-hidden">Coming</span></label>
      <button className="icon-button" aria-label="Notifications — Coming" title="Coming: notifications are not built in this preview." onClick={() => showComing('Notifications')}><Glyph name="bell"/></button><button className="icon-button help-trigger" aria-label="Help" onClick={() => showComing('Help')}><Glyph name="help"/></button>
      <div className="operator-chip"><span className="operator-avatar" aria-hidden="true">NO</span><span className="operator-label">NGO Operator (demo)</span></div>
    </header>
    <div className="overview-workspace"><Navigation onNavigate={setCurrent} onComing={showComing}/>
      {state.status === 'loading' ? <LoadingOverview/> : state.status === 'error' ? <ErrorOverview onRetry={() => window.location.reload()}/> : data && <div className="overview-main-layout" style={mainStyle}><main className="overview-main">
        <div className="overview-breadcrumb"><span>Incidents</span><span aria-hidden="true">›</span><span>{data.incident.id}</span><span aria-hidden="true">›</span><strong>Overview</strong></div>
        <section className="overview-card incident-card" aria-labelledby="incident-title">
          <div className="skyline-art" aria-hidden="true"><svg viewBox="0 0 220 150" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--aeg-high-bg)"/><stop offset="1" stopColor="var(--aeg-tile-bg)"/></linearGradient></defs><rect width="220" height="150" fill="url(#sky)"/><circle cx="158" cy="39" r="12" fill="var(--aeg-surface)" opacity=".8"/><path d="M0 111h18V77h10v34h8V59h16v52h9V72h14v39h11V40h18v71h8V70h12v41h13V56h19v55h9V76h18v35h20v39H0Z" fill="var(--aeg-brand-navy)" opacity=".72"/><path d="M0 127 37 113l30 10 32-17 31 15 28-12 62 15v26H0Z" fill="var(--aeg-ink-strong)" opacity=".42"/></svg></div>
          <div className="incident-summary"><span className="status-chip">● Active</span><span className="preview-stamp-mobile">Preview</span><h1 id="incident-title">{data.incident.title}</h1><p className="incident-meta">{data.incident.id} <span aria-hidden="true">|</span> {data.incident.region}</p><p className="reported-at">Reported {formatAbsolute(data.incident.reportedAt)}</p><div className="incident-tags">{data.incident.tags.map((tag, index) => <span key={tag}><Glyph name={['air', 'air', 'people'][index] ?? 'sparkle'} size={15}/>{tag}</span>)}</div></div>
          <aside className="situation-card"><span className="preview-stamp">Preview</span><span className="kpi-icon"><Glyph name="pin"/></span><div><small>Situation status</small><strong>{data.incident.situation.label}</strong><p>{data.incident.situation.note}</p></div></aside>
        </section>
        <div className="overview-tabs-container"><div ref={tabsScroller} className="overview-tabs" role="tablist" aria-label="Incident sections">{tabs.map((item, index) => <button role="tab" id={`overview-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="overview-tabpanel" tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'tab-active' : ''} key={item.id} onClick={() => setTab(item.id)} onKeyDown={(event) => tabKey(event, index)}>{item.label}</button>)}</div><button className="tab-scroll-hint" type="button" aria-label="Scroll to more incident sections" title="More sections" onClick={() => { if (tabsScroller.current) tabsScroller.current.scrollLeft = tabsScroller.current.scrollWidth; }}>›</button></div>
        <section id="overview-tabpanel" role="tabpanel" aria-labelledby={`overview-tab-${tab}`} className="tab-panel">
          {coming ? <ComingPanel name={coming} onBack={() => { setComing(null); setTab('overview'); }}/> : tab === 'overview' ? <OverviewBody data={data} onComing={showComing} onTab={setTab}/> : tab === 'people' ? <GroupRows data={data}/> : tab === 'resources' ? <ShortfallRows data={data}/> : tab === 'updates' ? <UpdateRows data={data}/> : <ComingPanel name={currentTab.label} onBack={() => setTab('overview')}/>}
        </section>
      </main><Divider value={split} onChange={setSplit}/><aside className="desktop-assist overview-card" aria-label="AI Assist"><div className="assist-heading"><span className="assist-logo"><Glyph name="sparkle" size={23}/></span><div><h2>{data.assist.title}</h2><p>{data.assist.subtitle}</p></div><span className="preview-chip">Preview</span><button className="icon-button collapse-assist" aria-label="Collapse AI Assist" onClick={() => setSplit(100 - 320 / Math.max(1, window.innerWidth - 260) * 100)}><span aria-hidden="true">›</span></button></div><AssistConversation data={data}/></aside></div>}
    </div>
    {data && <>
    {assistOpen && <Sheet title="AI Assist" onClose={closeAssist}><div className="sheet-handle" aria-hidden="true"/><p className="sheet-subtitle">{data.assist.subtitle}</p><AssistConversation data={data} mobile/></Sheet>}
    </>}
    {drawerOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}><aside className="overview-drawer" aria-label="Navigation drawer"><div className="drawer-heading"><img src="/brand/aegis-ngo-logo.webp" alt="Aegis NGO"/><button className="icon-button" onClick={closeDrawer} aria-label="Close navigation"><Glyph name="close"/></button></div><Navigation mobile onNavigate={setCurrent} onComing={showComing} onClose={closeDrawer}/></aside></div>}
  </div>;
}
