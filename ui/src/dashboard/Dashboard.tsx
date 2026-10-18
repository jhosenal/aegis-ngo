import {MobileSheetHandle,type MobileSheetState} from '../chat/MobileSheetHandle.js';
import './mobile-spatial.css';
import {useChatWorkspace} from '../chat/ChatWorkspace.js';
import {AccountMenu} from '../chat/AccountMenu.js';
import {ChatDock} from '../chat/ChatDock.js';
import { NewsMenu } from './NewsMenu.js';
import { MapLayerToolbar } from './MapLayerToolbar.js';
import { CardDialog as Modal } from '../components/CardDialog.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { ASEAN_COUNTRIES } from '../../../src/domains/asean.js';
import type { HazardTrend } from '../../../src/services/hazardTrend.js';
import { EnvironmentPopup } from './EnvironmentPopup.js';
import { ENVIRONMENT_COUNTRIES, useEnvironmentLayer, environmentPinLabel } from './environment.js';
import { clusterByGrid } from './cluster.js';
import { IncidentTrend } from './IncidentTrend.js';
import { apiRequest } from '../api/client.js';
import { CardView } from '../components/CardView.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { SignInScreen } from '../components/SignInScreen.js';
import { useWorkspaceStore, type CardViewData } from '../state/store.js';
import type { CardRevision } from '../../../src/types/domain.js';
import { WorkspaceSidebar } from '../shell/WorkspaceSidebar.js';
import { PAGE_LAYOUT, workspaceViews, mapToolbarLayout, type WorkspaceView } from '../formulations/pageTemplates.js';
import { SiteHeader } from '../shell/SiteChrome.js';
import { ASEAN_VIEW_BOUNDS, DEMO_AS_OF, coordinates, demoCards, field, loadDashboardCards, loadLiveGuestCards, position } from './data.js';
import { Icon } from './Icon.js';
import { HazardIcon, hazardSymbol, hazardSymbols } from '../components/HazardIcon.js';
import { sourceCredit } from '../components/SourceCredit.js';
import { HazardArtwork } from '../components/HazardArtwork.js';
import geography from './geography.json';
import { GoogleMapCanvas, type GoogleMapControls, type MapStatus, type MapFrame } from './GoogleMapCanvas.js';
import './dashboard.css';
import './dock.css';
import { ModuleCard } from '../components/ModuleCard.js';
import { Divider } from '../components/Divider.js';
import { PanelPuller } from '../components/PanelPuller.js';
import { NewsReader } from './NewsReader.js';
import { PinDropper } from './PinDropper.js';
import { canUseOperationalTools } from '../../../src/roles/access.js';
import { IncidentFocus } from './IncidentFocus.js';
import { NearbyPlaces } from './NearbyPlaces.js';
import { StreetViewPanel } from './StreetViewPanel.js';
import { SampleBanner, SampleToggle } from './SampleMode.js';
import { FeaturedHazards } from './FeaturedHazards.js';

import { HazardHistory } from './HazardHistory.js';
import {
  domainNumberForSymbol, endMs, loadHistory, monthEnd, monthIndexForTime, monthLabel, monthStarts, recentHistoryRange, startMs,
  type HistoryCard, type HistoryData, type HistoryRangeMs,
} from './history.js';
import catalogue from '../../../content/domains/catalogue.json';
type View = WorkspaceView;
const navigation = workspaceViews;
const readWorkspaceView = (): View => { const requested = new URLSearchParams(window.location.search).get('view'); return requested === 'incidents' ? 'incident' : workspaceViews.find(item=>item.id===requested)?.id ?? 'dashboard'; };
/** Cards the signed-out page builds from AHA ADInet reports and the live feeds: reported by a source, not records AEGIS stored or reviewed. */
const isReported = (item: CardViewData) => /^(AHA|LIVE)-/.test(item.card.cardId);
const hazardName = (card: CardViewData) => String(field(card.card, 'hazardType') ?? 'Unknown');
const hazardTone = (hazard: string) => ({ seismic: 'amber', hydrological: 'blue', meteorological: 'indigo', wildfire: 'fire', biological: 'purple', displacement: 'rose', volcanic: 'red', haze: 'slate', unknown: 'slate' })[hazardSymbol(hazard)];
const dateText = (at: string) => new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
function historyMapCard(item: HistoryCard): CardViewData {
  const fields: CardRevision['body']['fields'] = [
    { key: 'country', label: 'ASEAN country', value: item.countries.length ? item.countries.join(', ') : null, unit: null, epistemic: item.countries.length ? 'fact' : 'unknown' },
    { key: 'hazardType', label: 'Hazard type', value: item.hazardType, unit: null, epistemic: 'fact' },
    { key: 'incidentPeriod', label: 'Incident period', value: 'historical', unit: null, epistemic: 'fact' },
    { key: 'eventTime', label: 'Event date', value: item.eventStart, unit: null, epistemic: 'fact' },
    { key: 'alertLevel', label: 'Alert level', value: item.alertLevel.value, unit: null, epistemic: item.alertLevel.value ? 'fact' : 'unknown' },
    { key: 'location', label: 'Location', value: item.location.latE6 !== null && item.location.lonE6 !== null ? `${item.location.latE6},${item.location.lonE6}` : null, unit: 'micro-degrees (latitude, longitude)', epistemic: 'fact' },
    { key: 'source', label: 'Source', value: item.provenance.sourceName, unit: null, epistemic: 'fact' },
    { key: 'sourcePage', label: 'Source page', value: item.provenance.sourcePage, unit: null, epistemic: item.provenance.sourcePage ? 'fact' : 'unknown' },
    ...item.measurements.map(measurement => ({ key: measurement.key, label: measurement.label, value: measurement.value, unit: measurement.unit, epistemic: 'fact' as const })),
  ];
  const card: CardRevision = { cardId: `HISTORY-${item.id}`, tenantId: 'PUBLIC', kind: 'incident', revision: 1, state: 'draft', title: item.title,
    body: { kind: 'incident', status: 'ok', synthetic: false, syntheticLabel: null, summary: `Historical archive record for ${item.eventStart}. Source: ${item.provenance.sourceName}. ${item.provenance.licence.text}`, fields, sections: [], assumptions: [], warnings: [], missing: [], result: null },
    evidenceIds: [], formulationRef: null, workflowRunId: null, createdAt: item.eventStart, createdBy: 'public-hazard-history' };
  return { card, revisions: [card], latestRevision: 1, evidence: [] };
}

function Panel({ title, eyebrow, action, children, className = '' }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <ModuleCard cardId={`module:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} title={title} eyebrow={eyebrow} action={action} className={className}>{children}</ModuleCard>;
}


function RegionalMap({ cards, onOpen, overviewExpanded, country, regionControl, timelineControl, operational }: { cards: CardViewData[]; onOpen: (card: CardViewData) => void; overviewExpanded: boolean; country: string; regionControl:ReactNode; timelineControl:ReactNode; operational:boolean }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [includeGreen, setIncludeGreen] = useState<boolean>(mapToolbarLayout.initiallyEnabled);
  const [environmentEnabled, setEnvironmentEnabled] = useState<boolean>(mapToolbarLayout.initiallyEnabled);
  const [sampleMode, setSampleMode] = useState(false);   // per viewer, off by default, back to off on reload
  const environment = useEnvironmentLayer(true, sampleMode);
  const [environmentSelected, setEnvironmentSelected] = useState<string | null>(null);
  const [environmentGroup, setEnvironmentGroup] = useState<string[]>([]);
  const selectEnvironment = useCallback((id: string) => { setEnvironmentSelected(id); setEnvironmentGroup([]); }, []);
  const closeEnvironment = () => { setEnvironmentSelected(null); setEnvironmentGroup([]); };
  useLayoutEffect(() => { setEnvironmentSelected(null); setEnvironmentGroup([]); }, [country, environmentEnabled]);
  const availableEnvironmentPins = useMemo(() => (environment.data?.pins ?? []).filter(pin =>
    Number.isFinite(pin.lat) && Number.isFinite(pin.lng) && Math.abs(pin.lat) <= 90 && Math.abs(pin.lng) <= 180 && (!country || pin.country === ENVIRONMENT_COUNTRIES[country])), [environment.data, country]);
  const environmentPins = environmentEnabled ? availableEnvironmentPins : [];
  const popupPins = environmentSelected ? environmentPins.filter(pin => pin.pinId === environmentSelected) : environmentPins.filter(pin => environmentGroup.includes(pin.pinId));
  const mappableCards = useMemo(() => cards.filter(card => coordinates(card.card) !== null), [cards]);
  const liveMappableCards = mappableCards.filter(card => !card.card.cardId.startsWith('HISTORY-'));
  const greenCount = liveMappableCards.filter(c => !c.card.body.synthetic && String(field(c.card, 'alertLevel')).toUpperCase() === 'GREEN').length;
  const [zoom, setZoom] = useState(1);
  const [mapZoom,setMapZoom]=useState(4);
  const [mapsKey, setMapsKey] = useState(() => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim());
  const [mapStatus, setMapStatus] = useState<MapStatus>(mapsKey ? 'loading' : 'unconfigured');
  const [mapRetry, setMapRetry] = useState(0);
  const googleControls = useRef<GoogleMapControls>(null);
  const [frame, setFrame] = useState<MapFrame | null>(null);
  const [mapType, setMapType] = useState<'hybrid' | 'roadmap'>('hybrid');
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  useEffect(() => {
    if (mapsKey) return;
    let active = true;
    void fetch('/public/maps-config', { cache: 'no-store' })
      .then(async response => response.ok ? await response.json() as { mapsApiKey?: unknown } : null)
      .then(config => {
        const key = typeof config?.mapsApiKey === 'string' ? config.mapsApiKey.trim() : '';
        if (active && key) { setMapsKey(key); setMapStatus('loading'); }
      })
      .catch(() => { /* Keep the schematic map available when Maps is not configured. */ });
    return () => { active = false; };
  }, [mapsKey]);
  useEffect(() => {
    const sync = () => setMapFullscreen(document.fullscreenElement?.classList.contains('regional-map') ?? false);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    const heading = document.querySelector('.dashboard-page-heading');
    const update = () => {
      const bounds = heading?.getBoundingClientRect();
      const tray = document.querySelector('.regional-info-tray')?.getBoundingClientRect();
      const next = innerWidth > 1150 && bounds && document.querySelector('.regional-app')?.classList.contains('map-hero-mode') ? { left: bounds.left, right: innerWidth - bounds.right, bottom: overviewExpanded && tray ? innerHeight - tray.top + 24 : 40 } : null;
      setFrame(previous => previous?.left === next?.left && previous?.right === next?.right && previous?.bottom === next?.bottom ? previous : next);
    };
    const observer = new ResizeObserver(update);
    if (heading) observer.observe(heading);
    const tray = document.querySelector('.regional-info-tray');
    if (tray) observer.observe(tray);
    window.addEventListener('resize', update);
    update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [overviewExpanded]);
  const googleReady = mapStatus === 'ready';
  const visibleCards = useMemo(() => cards.filter((card) => !hidden.includes(hazardSymbol(hazardName(card))) && (includeGreen || card.card.body.synthetic || String(field(card.card, 'alertLevel')).toUpperCase() !== 'GREEN')), [cards, hidden, includeGreen]);
  const names = { seismic: 'earthquake', hydrological: 'flood', meteorological: 'storm', wildfire: 'wildfire', biological: 'biological', displacement: 'displacement', volcanic: 'volcano', haze: 'haze', unknown: 'other' };
  const present = liveMappableCards.map((card) => hazardSymbol(hazardName(card)));
  const hazards = [...hazardSymbols, ...(['haze', 'unknown'] as const).filter((id) => present.includes(id))];
  const offlineBox = (() => {
    if (!frame) { const width = Math.max(1000, ...visibleCards.map(c => (position(c.card)?.x ?? 0) + 60)); return `${width / 2 - width / 2 / zoom} ${325 - 325 / zoom} ${width / zoom} ${650 / zoom}`; }
    const { north, south, west, east } = ASEAN_VIEW_BOUNDS;
    const scale = Math.max(.1, Math.min(
      (innerWidth - frame.left - frame.right - 240) / ((east - west) / 51 * 1000),
      Math.max(150, innerHeight - frame.bottom - 100) / ((north - south) / 41 * 650),
    )) * zoom;
    const centerX = ((west + east) / 2 - 90) / 51 * 1000;
    const centerY = (28 - (north + south) / 2) / 41 * 650;
    const screenX = (frame.left + 190 + innerWidth - frame.right - 50) / 2;
    const screenY = (100 + innerHeight - frame.bottom) / 2;
    return `${centerX - screenX / scale} ${centerY - screenY / scale} ${innerWidth / scale} ${innerHeight / scale}`;
  })();
  const environmentClusters = clusterByGrid(environmentPins.map(pin => ({ id: pin.pinId, lat: pin.lat, lng: pin.lng })), 4 + Math.log2(zoom), 56, new Set(environmentSelected ? [environmentSelected] : []));
  const labels = [['MYANMAR', 96, 21], ['THAILAND', 101, 16], ['VIETNAM', 109, 19], ['CAMBODIA', 104, 12], ['MALAYSIA', 104, 4], ['SINGAPORE', 103.8, .3], ['INDONESIA', 117, -5], ['PHILIPPINES', 124, 11], ['BRUNEI', 115, 5.5]] as const;
  return <div className={`regional-map ${googleReady ? 'google-map-ready' : 'offline-map-active'}`} data-map-provider={googleReady ? 'google' : 'offline'} style={{ '--map-left': `${frame?.left ?? 0}px`, '--map-right': `${frame?.right ?? 0}px` } as CSSProperties}>
    <GoogleMapCanvas ref={googleControls} frame={frame} country={country} onZoomChange={setMapZoom} apiKey={mapsKey} retry={mapRetry} mapId={import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? ''} cards={visibleCards} onOpen={onOpen} onStatus={setMapStatus} environmentPins={environmentPins} selectedEnvironmentId={environmentSelected} onEnvironmentOpen={selectEnvironment}/>
    <svg className="offline-map" aria-hidden={googleReady} viewBox={offlineBox} role="group" aria-label="ASEAN schematic map. Markers open incident cards. Synthetic markers are labelled demo.">
    <defs><pattern id="map-grid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#ffffff" strokeOpacity=".045"/></pattern><linearGradient id="land-fill" x2="1" y2="1"><stop stopColor="#306876"/><stop offset="1" stopColor="#214857"/></linearGradient></defs>
    <rect width="1600" height="650" fill="#102d42"/><rect width="1600" height="650" fill="url(#map-grid)"/>
    <g className="map-land">{geography.map((country) => <path key={country.name} d={country.path}><title>{country.name}</title></path>)}</g>
    <text className="map-ocean" x="610" y="260">SOUTH CHINA SEA</text><text className="map-ocean" x="820" y="470">CELEBES SEA</text>
    {labels.map(([label, lon, lat]) => <text className="map-country" key={label} x={(lon - 90) / 51 * 1000} y={(28 - lat) / 41 * 650}>{label}</text>)}
    {visibleCards.map((card) => { const p = position(card.card); return p && <g key={card.card.cardId} role="button" tabIndex={0} aria-label={`Open ${card.card.title}${card.card.body.synthetic ? ', demo' : String(field(card.card, 'hazardType')).toLowerCase() === 'storm' ? ' - Storm position (GDACS)' : ''}`} className={`regional-map-marker hazard-theme-${hazardSymbol(hazardName(card))} tone-${hazardTone(hazardName(card))}`} transform={`translate(${p.x},${p.y})`} onClick={() => onOpen(card)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(card); } }}><title>{card.card.title}{card.card.body.synthetic ? ' · Demo' : ''}</title><circle className="marker-halo" r="23"/><circle className="marker-core" r="13"/><g className="map-hazard-symbol" transform="translate(-9,-9)"><HazardIcon hazard={hazardName(card)} size={18}/></g></g>; })}
    {environmentClusters.map(cluster => { const pin=environmentPins.find(pin=>pin.pinId===cluster.ids[0]); const label=cluster.ids.length===1 && pin ? environmentPinLabel(pin) : null; return <g key={`env-${cluster.ids[0]}`} className="offline-environment-marker" data-location-count={cluster.ids.length} role="button" tabIndex={googleReady ? -1 : 0} aria-label={cluster.ids.length > 1 ? `${cluster.ids.length} air and weather monitoring locations` : `Air and weather: ${environmentPins.find(pin => pin.pinId === cluster.ids[0])?.name}`} transform={`translate(${(cluster.lng - 90) / 51 * 1000},${(28 - cluster.lat) / 41 * 650})`} onClick={() => cluster.ids.length === 1 ? selectEnvironment(cluster.ids[0]!) : setEnvironmentGroup(cluster.ids)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (cluster.ids.length === 1) selectEnvironment(cluster.ids[0]!); else setEnvironmentGroup(cluster.ids); } }}>{label && <g className="offline-environment-reading" transform="translate(0,-42)"><rect x={-Math.max(94,label.text.length*6)/2} y="-15" width={Math.max(94,label.text.length*6)} height="32" rx="5"/><text y="-3">{label.text}</text><text className="environment-label-credit" y="9">Google</text><title>{label.description}</title></g>}<circle className="environment-marker-halo" r="23"/><circle className="environment-marker-core" r="13"/>{cluster.ids.length > 1 ? <text>{cluster.ids.length}</text> : <g transform="translate(-9,-9)"><Icon name="weather" size={18}/></g>}</g>; })}
  </svg><div className="regional-map-controls" id="regional-map-controls" hidden={!overviewExpanded}><div className="map-overlay-label" role="status"><span className="map-status-dot"/>{googleReady ? 'Google Maps' : mapStatus === 'loading' ? 'Loading Google Maps' : mapStatus === 'error' ? 'Google Maps unavailable · schematic map only, no streets or imagery' : 'Schematic map · Google Maps not connected'}{mapStatus === 'error' && mapsKey && <button type="button" className="map-retry" onClick={() => { setMapStatus('loading'); setMapRetry((n) => n + 1); }}>Retry Google Maps</button>} <span>·</span> {cards.some((item) => item.card.body.synthetic) ? 'Includes demo markers' : 'Card locations'}{cards.some(item => item.card.cardId.startsWith('HISTORY-')) && <> <span>·</span> {cards.filter(item => item.card.cardId.startsWith('HISTORY-')).length} historical pins</>}</div>
    <div className="map-top-toolbar" role="group" aria-label="Map layers and style"><div className="map-region-control">{regionControl}</div>
    <MapLayerToolbar layers={[
      {id:'environment',label:'Air & Weather',icon:<Icon name="weather" size={18}/>,count:environment.data?availableEnvironmentPins.length:null,enabled:environmentEnabled,toggle:()=>setEnvironmentEnabled(value=>!value)},
      ...(greenCount>0?[{id:'green',label:'GREEN alerts',icon:<Icon name="include" size={16}/>,count:greenCount,enabled:includeGreen,toggle:()=>setIncludeGreen(value=>!value)}]:[]),
      ...hazards.map(hazard=>({id:hazard,label:names[hazard],icon:<span className={`layer-hazard hazard-theme-${hazard} tone-${hazardTone(hazard)}`}><HazardIcon hazard={hazard} size={18}/></span>,count:present.filter(item=>item===hazard).length,enabled:!hidden.includes(hazard),toggle:()=>setHidden(current=>current.includes(hazard)?current.filter(item=>item!==hazard):[...current,hazard])})),
    ]} onToggleAll={enabled=>{setEnvironmentEnabled(enabled);setIncludeGreen(enabled);setHidden(enabled?[]:[...hazardSymbols,'haze','unknown']);}}>
      <p>Hazard badges count current incidents only. Historical pins follow the selected date range and do not change Live Feed or hazard totals. Clustered pins can represent several records. Live Feed counts current records, including cards without coordinates. Air &amp; Weather totals are separate monitoring sites.</p>
      {environment.loading&&!environment.data&&<p role="status">Loading monitoring locations...</p>}
      {environment.error&&<p role="status">Monitoring readings unavailable. <button className="map-layer-retry" onClick={environment.retry}>Retry air &amp; weather</button></p>}
      {environment.data&&availableEnvironmentPins.length===0&&<p>No monitoring locations in this region.</p>}
      {googleReady&&environmentPins.length>0&&<button className="map-layer-fit" onClick={()=>googleControls.current?.fitPoints(environmentPins)}>Fit monitoring locations</button>}
    </MapLayerToolbar>
    <NewsMenu/>
    <PinDropper mapReady={googleReady} inline sampleMode={sampleMode} operational={operational}/>
    <SampleToggle on={sampleMode} onToggle={() => setSampleMode((v) => !v)}/>
    <SampleBanner viewerOn={sampleMode} serverOn={environment.data?.demoActive === true}/>
    <div className="map-style-switch" aria-label="Basemap style">{(['roadmap', 'hybrid'] as const).map(type => <button key={type} disabled={!googleReady} aria-pressed={mapType === type} onClick={() => { googleControls.current?.setType(type); setMapType(type); }}>{type === 'roadmap' ? 'Map' : 'Satellite'}</button>)}</div>
    </div>
    <div className="map-zoom map-zoom-slider"><button aria-label="Zoom in" disabled={!googleReady && zoom === 2} onClick={() => googleReady ? googleControls.current?.zoom(1) : setZoom(value=>Math.min(2,value+.25))}>+</button><input type="range" aria-label="Map zoom" aria-orientation="vertical" aria-valuetext={`Zoom level ${(googleReady?mapZoom:4+Math.log2(zoom)).toFixed(1)}`} min={googleReady?3:4} max={googleReady?19:5} step="0.1" value={googleReady?mapZoom:4+Math.log2(zoom)} onChange={event=>{const level=Number(event.target.value);if(googleReady){googleControls.current?.setZoom(level);setMapZoom(level);}else setZoom(2**(level-4));}}/><button aria-label="Zoom out" disabled={!googleReady && zoom === 1} onClick={() => googleReady ? googleControls.current?.zoom(-1) : setZoom(value=>Math.max(1,value-.25))}>−</button></div>
    </div>{!googleReady && <a className="map-attribution" href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer">© Natural Earth · public domain</a>}
    <button className="map-expand" aria-label={mapFullscreen ? 'Exit map fullscreen' : 'Expand map'} title={mapFullscreen ? 'Exit map fullscreen' : 'Expand map'} onClick={event => {
      const root = event.currentTarget.closest<HTMLElement>('.regional-map');
      setFullscreenError('');
      const action = document.fullscreenElement ? document.exitFullscreen() : root?.requestFullscreen?.();
      if (action) void action.catch(() => setFullscreenError('Fullscreen unavailable in this browser.'));
      else setFullscreenError('Fullscreen unavailable in this browser.');
    }}><Icon name="expand" size={18}/></button>
    {fullscreenError && <span className="map-fullscreen-error" role="status">{fullscreenError}</span>}
    {environmentEnabled && popupPins.length > 0 && <EnvironmentPopup key={environmentSelected ?? environmentGroup.join('|')} pins={popupPins} attribution={environment.data?.attribution} updates={environment.data?.updates} onSelect={selectEnvironment} onClose={closeEnvironment} onDemand={environment.data?.onDemand?.enabled === true && !sampleMode} onRefresh={environment.refreshPin}/>}
    <NewsReader countryView={!!country && country!=='__offshore'}/>
    <IncidentFocus/>
    <NearbyPlaces/>
    <StreetViewPanel/>
    {timelineControl}
  </div>;
}

interface AhaWeekly { adinetReports?: { status: string; country?: string; affectedFamilies?: number | null }[]; reports: { week: number; period: string; regionalTally: { affectedPersons: string | number | null }; highlights: { country: string; affected: number | null }[] }[] }
interface DataConfidenceTile { score: number | null; band: string | null }

export function Dashboard() {
  const chatWorkspace=useChatWorkspace();
  const [state, dispatch] = useWorkspaceStore();
  const [view, setView] = useState<View>(readWorkspaceView);
  const [incidentPage, setIncidentPage] = useState(0);
  const [hazardFilter, setHazardFilter] = useState<string | null>(() => { const hazard = new URLSearchParams(window.location.search).get('hazard'); return hazardSymbols.includes(hazard as typeof hazardSymbols[number]) ? hazard : null; });
  const [feedMode, setFeedMode] = useState<'live' | 'history'>('live');
  const [historyWindow, setHistoryWindow] = useState<HistoryData['window']>(() => ({ from: '2016-01-01', to: new Date().toISOString().slice(0, 10) }));
  const [historyRange, setHistoryRange] = useState<HistoryRangeMs | null>(null);
  const [historyCards, setHistoryCards] = useState<HistoryCard[]>([]);
  const [historyCardsLoaded, setHistoryCardsLoaded] = useState(false);
  const [historyFocusId, setHistoryFocusId] = useState<string | null>(null);
  const [region, setRegion] = useState('');
  useEffect(() => {
    const selectNewsCountry = (event: Event) => {
      const country = (event as CustomEvent<{ country: string }>).detail?.country;
      if (country === '' || country === 'Singapore' || country === 'Malaysia' || country === 'Brunei') {
        setRegion(country);
        setRegionMenuOpen(false);
      }
    };
    window.addEventListener('aegis-news-country', selectNewsCountry);
    return () => window.removeEventListener('aegis-news-country', selectNewsCountry);
  }, []);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const regionPickerRef = useRef<HTMLDivElement>(null);
  const regionPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const [trend, setTrend] = useState<HazardTrend | null>(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState(false);
  // Real figures for the two summary tiles that have no demo value: the AHA Centre weekly tally (transcribed, reported only) and the PROVISIONAL feed-health score.
  const [aha, setAha] = useState<AhaWeekly | null>(null);
  const [confidence, setConfidence] = useState<DataConfidenceTile | null>(null);
  const [places, setPlaces] = useState<{ total: number } | null>(null);
  useEffect(() => {
    if (view !== 'dashboard' && view !== 'incident') return;
    let active = true;
    void loadHistory().then(data => {
      if (!active) return;
      setHistoryCards(data.cards);
      setHistoryWindow(data.window);
      setHistoryRange(current => current ?? recentHistoryRange(data.window));
      setHistoryCardsLoaded(true);
    }).catch(() => { if (active) { setHistoryCards([]); setHistoryCardsLoaded(true); } });
    return () => { active = false; };
  }, [view]);
  useEffect(() => {
    let active = true;
    void apiRequest<AhaWeekly>('/public/aha-weekly').then(data => { if (active) setAha(data); }).catch(() => undefined);
    void apiRequest<DataConfidenceTile>('/public/data-confidence').then(data => { if (active) setConfidence(data); }).catch(() => undefined);
    void apiRequest<{ total: number }>('/public/places/counts').then(data => { if (active && data.total > 0) setPlaces(data); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const [trendRetry, setTrendRetry] = useState(0);
  useEffect(() => {
    if (!regionMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!regionPickerRef.current?.contains(event.target as Node)) setRegionMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [regionMenuOpen]);
  const [menu, setMenu] = useState(false);
  const [assist, setAssist] = useState(false);
  const [sheetState,setSheetState]=useState<MobileSheetState>('peek');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [split, setSplit] = useState(71.4286);
  const [panelResized,setPanelResized]=useState(false);
  const resizePanels=(value:number)=>{setPanelResized(true);setSplit(value);};
  const [authCallback] = useState(() => /^#(register|aegis_session)=/.test(window.location.hash) || window.location.search.includes('login_error=') || new URLSearchParams(window.location.search).get('login') === 'true');
  const [login, setLogin] = useState(authCallback);
  const [selected, setSelected] = useState<CardViewData | null>(null);
  const [notice, setNotice] = useState('');
  const [activeMetricDetails, setActiveMetricDetails] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const token = state.session?.token;
  const demo = !token;
  // The sidebar that normally configures the chat is not mounted on the public landing page, so configure it here too (it is idempotent).
  useEffect(()=>{chatWorkspace.configure(state.session??null);},[state.session?.token,state.session?.user.userId]);
  const mobileNavigation = viewportWidth < 768;
  const overlayAssistant = viewportWidth <= 1150;
  const navigationShown = mobileNavigation ? menu : !navCollapsed;
  const assistantShown = mobileNavigation ? true : overlayAssistant ? assist : !dockCollapsed;
  const changeSheet=(next:MobileSheetState)=>{setSheetState(next);setAssist(next!=='peek');setMenu(false);};
  useEffect(()=>{if(mobileNavigation)setSheetState(previous=>assist?(previous==='peek'?'half':previous):'peek');},[assist,mobileNavigation]);

  useEffect(() => {
    document.querySelector<HTMLElement>('.dashboard-main')?.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>('.regional-info-tray')?.scrollTo({ top: 0 });
    setIncidentPage(0);
  }, [region, view, hazardFilter]);

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const hazard = params.get('hazard');
      setHazardFilter(hazardSymbols.includes(hazard as typeof hazardSymbols[number]) ? hazard : null);
      setView(readWorkspaceView());
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    const resized = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);

  useEffect(() => {
    let active = true;
    setTrendLoading(true);
    setTrendError(false);
    void apiRequest<HazardTrend>('/public/hazards/trend?days=7').then(data => {
      if (active) { setTrend(data); setTrendLoading(false); }
    }).catch(() => { if (active) { setTrend(null); setTrendError(true); setTrendLoading(false); } });
    return () => { active = false; };
  }, [refresh, trendRetry]);

  function toggleNavigation() {
    if (mobileNavigation) { setAssist(false); setMenu((value) => !value); }
    else { setMenu(false); setNavCollapsed((value) => !value); }
  }

  function toggleAssistant() {
    if (overlayAssistant) { setMenu(false); setDockCollapsed(false); setAssist((value) => !value); }
    else { setAssist(false); setDockCollapsed((value) => !value); }
  }

  useEffect(() => {
    const overlay = menu && mobileNavigation ? document.querySelector<HTMLElement>('.dashboard-sidebar.nav-open') : assist && overlayAssistant && (!mobileNavigation||sheetState==='full') ? document.querySelector<HTMLElement>('.dashboard-assist.assist-open') : null;
    if (!overlay) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const puller = document.querySelector<HTMLElement>(`[data-panel-toggle="${menu && mobileNavigation ? 'navigation' : 'assistant'}"]`);
    const controls = () => [...overlay.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea,input:not(:disabled),select'), ...(puller ? [puller] : [])].filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { setMenu(false); setAssist(false); }
      if (event.key !== 'Tab') return;
      const items = controls(); const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [menu, assist, mobileNavigation, overlayAssistant,sheetState]);

  useEffect(() => {
    if (!token) return;
    setLogin(false);
    let cancelled = false;
    dispatch({ type: 'loading-cards', value: true });
    dispatch({ type: 'error-cards', value: null });
    dispatch({ type: 'cards', cards: [] });
    setSelected(null);
    setLoadedAt(null);
    void loadDashboardCards(token).then((cards) => {
      if (cancelled) return;
      dispatch({ type: 'cards', cards });
      setLoadedAt(new Date().toISOString());
    }).catch(() => { if (!cancelled) dispatch({ type: 'error-cards', value: 'System cards could not be loaded. Demo records have not been substituted.' }); })
      .finally(() => { if (!cancelled) dispatch({ type: 'loading-cards', value: false }); });
    void apiRequest<{ pins: { cardId: string }[] }>('/api/pins', { token }).then(({ pins }) => { if (!cancelled) dispatch({ type: 'pins', pins: pins.map((pin) => pin.cardId) }); }).catch(() => { if (!cancelled) setNotice('Pinned cards could not be loaded.'); });
    return () => { cancelled = true; };
  }, [token, refresh, dispatch]);

  // Signed out: the real feed records (labelled with their source). The synthetic fixtures are only the fallback when the feed returns nothing.
  const [guestCards, setGuestCards] = useState<CardViewData[] | null>(null);
  const [guestRefresh, setGuestRefresh] = useState(0);
  useEffect(() => {
    if (!demo) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setGuestRefresh(value => value + 1);
    }, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [demo]);
  useEffect(() => {
    if (!demo) return;
    let active = true;
    void loadLiveGuestCards().then(list => { if (active) setGuestCards(list); }).catch(() => { if (active) setGuestCards([]); });
    return () => { active = false; };
  }, [demo, refresh, guestRefresh]);
  const liveGuest = demo && guestCards !== null && guestCards.length > 0;
  const cards = demo ? (liveGuest ? guestCards : demoCards) : state.cards;
  const countryPending = cards.some(item => item.card.kind === 'incident' && !item.card.body.fields.some(f => f.key === 'country'));
  const filtered = useMemo(() => cards.filter(({ card }) => {
    const country = card.body.fields.find(f => f.key === 'country');
    return !region || (!!country && (region === '__offshore' ? country.value === null : country.value === region));
  }), [cards, region]);
  const incidents = filtered.filter(({ card }) => card.kind === 'incident');
  const commandCenter = (view as View) === 'incident';
  const pageSize = 8;
  const listCards = filtered.filter(item => item.card.kind === view && (!hazardFilter || (hazardSymbol(hazardName(item)) === hazardFilter && field(item.card, 'incidentPeriod') === 'current')));
  const pageCount = Math.max(1, Math.ceil(listCards.length / pageSize));
  const activePage = Math.min(incidentPage, pageCount - 1);
  const liveIncidents = incidents.filter(item => field(item.card, 'incidentPeriod') === 'current');
  const activeLiveIncidents = liveIncidents.filter(item => !hazardFilter || hazardSymbol(hazardName(item)) === hazardFilter);
  const timelineMonths = useMemo(() => monthStarts(historyWindow.from, new Date(`${historyWindow.to}T00:00:00Z`)), [historyWindow]);
  const activeHistoryRange = historyRange ?? recentHistoryRange(historyWindow);
  const historyFromMs = activeHistoryRange[0];
  const historyToMs = activeHistoryRange[1];
  const archiveIncidentCount = useMemo(() => historyCards.filter(item =>
    (!hazardFilter || item.domain === domainNumberForSymbol(hazardFilter)) &&
    startMs(item.eventStart) <= historyToMs && endMs(item) >= historyFromMs,
  ).length, [historyCards, hazardFilter, historyFromMs, historyToMs]);
  const historicalMapCards = useMemo(() => historyCards.filter(item =>
    item.location.latE6 !== null && item.location.lonE6 !== null && startMs(item.eventStart) <= historyToMs && endMs(item) >= historyFromMs &&
    (!region || (region === '__offshore' ? item.countries.length === 0 : item.countries.includes(region))) &&
    (!hazardFilter || item.domain === domainNumberForSymbol(hazardFilter)),
  ).map(historyMapCard), [historyCards, historyFromMs, historyToMs, region, hazardFilter]);
  const dashboardMapCards = [...incidents.filter(item => field(item.card, 'incidentPeriod') !== 'historical'), ...historicalMapCards];
  const feedPageCount = Math.max(1, Math.ceil(activeLiveIncidents.length / pageSize));
  const activeFeedPage = Math.min(incidentPage, feedPageCount - 1);
  const resourceCards = filtered.filter(({ card }) => card.kind === 'resource');
  const pending = !demo && (!loadedAt || state.loading.cards || !!state.errors.cards);
  const openCard = (card: CardViewData) => {
    if (card.card.cardId.startsWith('HISTORY-')) {
      setNotice(''); setSelected(null); setHistoryFocusId(card.card.cardId.slice('HISTORY-'.length)); setFeedMode('history');
      if (view !== 'incident') { setView('incident'); setHazardFilter(null); const url = new URL(window.location.href); url.searchParams.set('view', 'incidents'); url.searchParams.delete('hazard'); window.history.pushState(null, '', url); }
      return;
    }
    setNotice(''); setSelected(card);
  };
  // The chat's "Open full card" (IncidentFocus) asks for a card by id.
  useEffect(() => {
    const h = (event: Event): void => { const d = (event as CustomEvent<{ cardId: string }>).detail; const hit = state.cards.find((item) => item.card.cardId === d?.cardId); if (hit) openCard(hit); };
    window.addEventListener('aegis-open-card', h);
    return () => window.removeEventListener('aegis-open-card', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cards]);
  const changeView = (next: View) => { setView(next); setMenu(false); setHazardFilter(null); setFeedMode('live'); const url = new URL(window.location.href); if(next==='dashboard')url.searchParams.delete('view');else url.searchParams.set('view',next); url.searchParams.delete('hazard'); if(url.href!==window.location.href)window.history.pushState(null, '', url); };
  const openHazard = (hazard: string) => { setHazardFilter(hazard); setView('incident'); setIncidentPage(0); const url = new URL(window.location.href); url.searchParams.set('view', 'incidents'); url.searchParams.set('hazard', hazard); window.history.pushState(null, '', url); };
  const clearHazard = () => { setHazardFilter(null); setIncidentPage(0); const url = new URL(window.location.href); url.searchParams.delete('hazard'); window.history.pushState(null, '', url); };
  const hazardLabel = (symbol: string) => catalogue.domains.find(domain => hazardSymbol(domain.name) === symbol)?.name ?? symbol;
  const showDemo = demo && !liveGuest;
  const sourceLabel = showDemo ? 'Synthetic demo' : demo ? 'Live feeds' : 'System records';
  const latestAha = aha?.reports?.[0];
  const ahaThailand = latestAha?.highlights.find(h => h.country === 'Thailand');
  const ahaTile = latestAha?.regionalTally?.affectedPersons ? { value: String(latestAha.regionalTally.affectedPersons), note: `AHA Centre Week ${latestAha.week} (${latestAha.period}) regional tally, as reported; not verified by AEGIS.${ahaThailand?.affected ? ` The Thailand flood is reported separately: ${(ahaThailand.affected / 1e6).toFixed(1)}M affected since 16 Sep (DDPM).` : ''}` } : null;
  const ahaActive = aha?.adinetReports?.filter(r => r.status === 'ACTIVE').length ?? null;
  const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  // Families the ADInet reports state as affected (a sum of reported figures; reports that state none add nothing).
  const familyReports = (aha?.adinetReports ?? []).filter(r => typeof r.affectedFamilies === 'number');
  const familiesTotal = familyReports.reduce((sum, r) => sum + (r.affectedFamilies ?? 0), 0);
  // Where each tile's number comes from (hover text). Real mode names the source; demo mode says the value is a placeholder.
  const provenanceOf = (title: string): string => {
    if (showDemo) return 'Demo preview value. Synthetic placeholder, not from any source.';
    switch (title) {
      case 'Incident cards': return 'USGS and GDACS live feeds plus AHA Centre ADInet reports, counted as loaded now. Each card names its source and date. Shown as published; AEGIS has not verified them.';
      case 'Ongoing responses': return 'AHA Centre ADInet reports with status ACTIVE, counted as loaded now. A count of reports, not of response operations.';
      case 'People potentially affected': return 'AHA Centre Weekly Disaster Update, Week 41 (5 - 11 Oct 2026), quoting national agencies. A reported figure, not verified by AEGIS. Licence unverified.';
      case 'Data confidence': return 'Calculated by AEGIS from the health of the live feeds (provisional formula: equal weights, placeholder thresholds). It is not an accuracy score for any incident.';
      case 'Families affected': return 'Sum of the families stated as affected in the AHA Centre ADInet reports shown on this page. Reported figures, not verified by AEGIS; reports that state no family count add nothing.';
      case 'Essential places': return 'OpenStreetMap contributors (ODbL), stored by AEGIS and used by Nearby Relief. Locations only, not live capacity, stock or deployments. Not verified by AEGIS.';
      default: return 'No source connected yet. AEGIS shows no number here rather than a guess.';
    }
  };
  const metrics: { title: string; value: string; icon: string; tone: string; note: string; target?: View; tag?: string; demoOnly?: boolean }[] = [
    { title: 'Incident cards', value: pending ? '\u2014' : String(incidents.length).padStart(2, '0'), icon: 'alert', tone: 'red', note: 'Registered incident records', target: 'incident' as View },
    { title: showDemo || familiesTotal === 0 ? 'At-risk communities' : 'Families affected', value: showDemo ? '03' : familiesTotal > 0 ? compact(familiesTotal) : 'Not tracked', tag: showDemo ? undefined : familiesTotal > 0 ? 'AHA ADInet' : 'No registry', icon: 'people', tone: 'blue', note: showDemo ? 'Illustrative community count' : familiesTotal > 0 ? `${familiesTotal.toLocaleString('en')} families reported affected across ${familyReports.length} ADInet reports. A sum of reported figures; AEGIS has no community registry.` : 'AEGIS has no community registry. Affected areas are named in each incident card.' },
    { title: resourceCards.length === 0 && !showDemo && places ? 'Essential places' : 'Resource cards', value: pending ? '—' : resourceCards.length === 0 && !showDemo ? (places ? compact(places.total) : 'None yet') : String(resourceCards.length).padStart(2, '0'), tag: resourceCards.length === 0 && !showDemo && !pending ? (places ? 'OpenStreetMap' : 'No source connected') : undefined, icon: 'box', tone: 'green', note: resourceCards.length === 0 && !showDemo ? (places ? `${places.total.toLocaleString('en')} hospitals, clinics, pharmacies, police, fire stations, shelters and disaster centres stored for Nearby Relief. Locations only; no stock or deployments.` : 'No resource records registered. Inventory is not connected to a source.') : 'Inventory records, not deployments', target: 'resource' as View },
    { title: 'Ongoing responses', value: showDemo ? '05' : ahaActive ? String(ahaActive).padStart(2, '0') : 'Unknown', tag: !showDemo && ahaActive ? 'AHA ADInet' : undefined, icon: 'refresh', tone: 'amber', note: showDemo ? 'Illustrative response count' : ahaActive ? 'Active reports on AHA ADInet. Each report states what authorities are doing. Not a count of response operations.' : 'Response registry pending' },
    { title: 'People potentially affected', value: showDemo ? '~1.2M' : ahaTile ? ahaTile.value : 'Unknown', tag: showDemo ? 'Regional estimate' : ahaTile ? 'AHA Centre, reported' : undefined, demoOnly: true, icon: 'people', tone: 'purple', note: showDemo ? 'Based on active hazard exposure zones. Demo placeholder; exposure-zone inputs are not connected.' : ahaTile ? ahaTile.note : 'Regional estimate pending' },
    { title: 'Data confidence', value: showDemo ? '89%' : confidence?.score != null ? `${confidence.score}%` : 'Not assessed', tag: showDemo ? 'High Confidence' : confidence?.score != null ? `Provisional, ${confidence.band?.toLowerCase() ?? ''}` : undefined, demoOnly: true, icon: 'shield', tone: 'teal', note: showDemo ? 'Cross-verified across GDACS & WHO feeds. Demo placeholder; cross-source corroboration is not implemented.' : confidence?.score != null ? 'Health of the live feeds (USGS, GDACS), not the accuracy of any incident. Provisional formula.' : 'Scoring method pending' },
  ];

  async function togglePin(card: CardViewData) {
    if (!token) {
      dispatch({ type: 'toggle-pin', cardId: card.card.cardId });
      setNotice('Demo pin saved for this page session. It does not attach the card to chat.');
      return;
    }
    try {
      const result = await apiRequest<{ pins: { cardId: string }[] }>(`/api/pins/${encodeURIComponent(card.card.cardId)}`, { token, method: state.pins.includes(card.card.cardId) ? 'DELETE' : 'PUT' });
      dispatch({ type: 'pins', pins: result.pins.map((pin) => pin.cardId) });
    } catch { setNotice('The pin could not be saved. Try again.'); }
  }

  // OAuth returns complete outside the native modal so the registration portal
  // remains interactive. Resume the dashboard after the session is validated.


  const pinnedContent = state.pins.length > 0 && <div className="dashboard-pins"><Icon name="pin" size={16}/><strong>Pinned cards</strong>{cards.filter((item) => state.pins.includes(item.card.cardId)).map((item) => <button key={item.card.cardId} onClick={() => openCard(item)}>{item.card.title}</button>)}</div>;

  const collection = (items: CardViewData[], compact = false) => <div className={`regional-card-list ${compact ? 'compact-cards' : 'visual-cards'}`}>{items.length === 0 ? <div className="dashboard-empty"><Icon name="layers" size={28}/><strong>{pending ? 'Cards unavailable' : 'No matching cards'}</strong><p>{pending ? 'Check the system status above.' : 'Try another filter, or add records in the workspace.'}</p></div> : items.map((item) => <button className={`regional-card-row ${!item.card.body.synthetic ? 'live-incident-card' : ''} ${item.card.kind === 'incident' ? `incident-visual-card hazard-theme-${hazardSymbol(hazardName(item))}` : ''}`} key={item.card.cardId} onClick={() => openCard(item)}>
    {item.card.kind === 'incident' ? <HazardArtwork hazard={hazardName(item)} className="incident-card-art" badge={<span className={`severity severity-${String(field(item.card, 'alertLevel') ?? '').toLowerCase()}`}>{String(field(item.card, 'alertLevel') ?? (isReported(item) ? 'Unrated' : item.card.state))}</span>}/> : <span className="hazard-avatar tone-blue"><Icon name="box"/></span>}
    <span className="incident-card-body"><span className="incident-card-topline"><span className="incident-hazard-label">{item.card.kind === 'incident' ? hazardName(item) : item.card.kind}</span></span>
    <span className="regional-card-copy"><strong>{item.card.title}</strong><small><Icon name="pin" size={13}/>{item.card.kind === 'incident' ? (item.card.body.fields.some(f => f.key === 'country') ? String(field(item.card, 'country') ?? 'Offshore / unspecified') : 'Country not classified') : String(field(item.card, 'regionId') ?? item.card.kind)}</small></span>
    {!compact && <span className="incident-card-summary">{item.card.body.summary}</span>}
    {!item.card.body.synthetic && item.evidence[0] && <span className="incident-card-timing">Published {item.evidence[0].publishedAt ? dateText(item.evidence[0].publishedAt) : 'Unknown'}</span>}
    {!item.card.body.synthetic && !item.evidence[0] && field(item.card, 'source') && <span className="incident-card-timing">Source: {String(field(item.card, 'source'))}{field(item.card, 'eventTime') ? ` · event ${String(field(item.card, 'eventTime')).slice(0, 10)}` : ''}</span>}
    <span className="incident-card-credit">{item.evidence.filter(e => !e.synthetic).map(sourceCredit).join(' ? ')}</span>
    <span className="incident-card-footer"><span>{item.card.body.synthetic ? 'Synthetic record' : isReported(item) ? 'Reported by source, not verified' : 'System record'}{!isReported(item) && <><span aria-hidden="true"> / </span> r{item.card.revision}</>}</span><span className="incident-card-open">View card <Icon name="arrow" size={14}/></span></span></span>
  </button>)}</div>;

  // Admin news approval (?previewBulletin=ID): the page is the real landing page; CSS hides everything except the hero card (see dashboard.css .is-preview-hero).
  const previewHero = new URLSearchParams(window.location.search).get('previewBulletin') !== null;
  // The frame is a full desktop-width viewport (so the desktop layout rules apply) cropped to the admin column; the hero is exactly that column wide (?heroWidth=, updated by postMessage when the admin column is resized).
  const [previewWidth, setPreviewWidth] = useState<number | null>(() => { const w = Number(new URLSearchParams(window.location.search).get('heroWidth')); return Number.isFinite(w) && w > 200 ? w : null; });
  useEffect(() => {
    if (!previewHero) return;
    const onMessage = (event: MessageEvent): void => { if (event.origin === window.location.origin && event.data?.type === 'aegis-preview-width' && Number.isFinite(event.data.width) && event.data.width > 200) setPreviewWidth(Number(event.data.width)); };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [previewHero]);
  // The trend counts come from stored USGS/GDACS records only. Active AHA ADInet report cards on the page are added by country so the menu matches the cards listed.
  const ahaActiveByCountry = new Map<string, number>();
  for (const item of liveIncidents) if (item.card.cardId.startsWith('AHA-')) { const name = String(field(item.card, 'country') ?? ''); ahaActiveByCountry.set(name, (ahaActiveByCountry.get(name) ?? 0) + 1); }
  const ahaActiveTotal = [...ahaActiveByCountry.values()].reduce((a, b) => a + b, 0);
  const allRegionCount = trend && !trendLoading ? trend.byCountry.reduce((count, country) => count + country.active, trend.countryUnknown) + ahaActiveTotal : '—';
  const regionOptions = [
    { value: '', label: `All ASEAN (${allRegionCount})` },
    ...ASEAN_COUNTRIES.map(country => ({ value: country.name, label: `${country.name} (${!trendLoading && trend ? (trend.byCountry.find(item => item.iso3 === country.iso3)?.active ?? 0) + (ahaActiveByCountry.get(country.name) ?? 0) : '—'})` })),
    { value: '__offshore', label: `Offshore / unspecified (${!trendLoading ? trend?.countryUnknown ?? '—' : '—'})` },
  ];
  const selectedRegionLabel = regionOptions.find(option => option.value === region)?.label ?? regionOptions[0].label;
  const focusRegionOption = (direction: -1 | 1 | 'first' | 'last') => {
    const options = regionPickerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!options?.length) return;
    const current = Array.from(options).indexOf(document.activeElement as HTMLButtonElement);
    const next = direction === 'first' ? 0 : direction === 'last' ? options.length - 1 : (current + direction + options.length) % options.length;
    options[next].focus();
  };
  const regionSelector=<div className="region-select map-region-picker" ref={regionPickerRef}>
    <svg className="map-control-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    <button ref={regionPickerTriggerRef} type="button" className="map-region-picker-trigger" aria-label="Region" aria-haspopup="menu" aria-expanded={regionMenuOpen} onClick={() => setRegionMenuOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setRegionMenuOpen(true); requestAnimationFrame(() => focusRegionOption('first')); } }}>
      <span>{selectedRegionLabel}</span>
    </button>
    {regionMenuOpen && <div className="map-region-menu" role="menu" aria-label="Select map region" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setRegionMenuOpen(false); regionPickerTriggerRef.current?.focus(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); focusRegionOption(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); focusRegionOption(-1); }
      else if (event.key === 'Home') { event.preventDefault(); focusRegionOption('first'); }
      else if (event.key === 'End') { event.preventDefault(); focusRegionOption('last'); }
    }}>
      {regionOptions.map(option => <button key={option.value || 'all'} type="button" role="menuitemradio" aria-checked={region === option.value} className="map-region-option" onClick={() => { setRegion(option.value); setRegionMenuOpen(false); regionPickerTriggerRef.current?.focus(); }}>{option.label}</button>)}
    </div>}
    <span className="sr-only">Counts are current public-feed incidents. Country selection filters workspace cards by their ASEAN country field; the daily activity chart covers all ASEAN feed records. Guest cards are synthetic examples.</span>
  </div>;
  const timelineStartIndex = monthIndexForTime(timelineMonths, historyFromMs);
  const timelineEndIndex = monthIndexForTime(timelineMonths, historyToMs);
  const timelineLastIndex = Math.max(1, timelineMonths.length - 1);
  const timelineStartPercent = timelineStartIndex / timelineLastIndex * 100;
  const timelineEndPercent = timelineEndIndex / timelineLastIndex * 100;
  const timelineStartMonth = timelineMonths[timelineStartIndex] ?? historyFromMs;
  const timelineEndMonth = timelineMonths[timelineEndIndex] ?? historyToMs;
  const moveHistoryStart = (index: number) => {
    const month = timelineMonths[index];
    if (month === undefined) return;
    setHistoryRange(current => {
      const [, to] = current ?? activeHistoryRange;
      return [Math.min(month, to), to];
    });
  };
  const moveHistoryEnd = (index: number) => {
    const month = timelineMonths[index];
    if (month === undefined) return;
    const latest = new Date(`${historyWindow.to}T23:59:59.999Z`).getTime();
    const end = Math.min(monthEnd(month), latest);
    setHistoryRange(current => {
      const [from] = current ?? activeHistoryRange;
      return [from, Math.max(from, end)];
    });
  };
  const timelineTrack = `linear-gradient(to right, #718797 0%, #718797 ${timelineStartPercent}%, #a6dfff ${timelineStartPercent}%, #a6dfff ${timelineEndPercent}%, #718797 ${timelineEndPercent}%, #718797 100%)`;
  const timelineControl = <div className="command-center-timeline" role="group" aria-label="Map incident history range">
    <span className="command-center-timeline-start" title={historyWindow.from.slice(0, 4)}>{historyWindow.from.slice(0, 4)}</span>
    <div className="command-center-timeline-range" role="group" aria-label={`Select map incident date range from ${monthLabel(timelineStartMonth)} to ${monthLabel(timelineEndMonth)}`}>
      <span className="command-center-timeline-track" style={{ background: timelineTrack }} aria-hidden="true"/>
      <input className="timeline-range-start" type="range" min="0" max={Math.max(0, timelineMonths.length - 1)} step="1" value={timelineStartIndex} aria-label={`Start month, ${monthLabel(timelineStartMonth)}`} title={`Start month: ${monthLabel(timelineStartMonth)}`} onChange={event => moveHistoryStart(Number(event.target.value))}/>
      <input className="timeline-range-end" type="range" min="0" max={Math.max(0, timelineMonths.length - 1)} step="1" value={timelineEndIndex} aria-label={`End month, ${monthLabel(timelineEndMonth)}`} title={`End month: ${monthLabel(timelineEndMonth)}`} onChange={event => moveHistoryEnd(Number(event.target.value))}/>
    </div>
    <span className="command-center-timeline-end" title={historyWindow.to.slice(0, 4)}>{historyWindow.to.slice(0, 4)}</span>
    <span className="sr-only">The map and archive show {monthLabel(historyFromMs)} through {monthLabel(historyToMs)}. The default range is the last three months; drag the handles to widen or narrow it.</span>
  </div>;
  const commandCenterControls = <section className="command-center-controls" aria-label="Incident feed controls">
    <div className="command-center-control-row">
      <div className="command-center-view-toggle" role="group" aria-label="Incident view mode">
        <button type="button" aria-pressed={feedMode === 'live'} onClick={() => setFeedMode('live')}><span className="command-center-live-dot" aria-hidden="true"/> Live Feed ({activeLiveIncidents.length})</button>
        <button type="button" aria-pressed={feedMode === 'history'} onClick={() => setFeedMode('history')}><span aria-hidden="true">{'\uD83D\uDCDC'}</span> Historical Archive ({historyCardsLoaded ? archiveIncidentCount : '\u2026'})</button>
      </div>
      <label className="command-center-hazard-select"><span className="sr-only">Filter by hazard</span><select aria-label="Quick hazard filter" value={hazardFilter ?? ''} onChange={event => event.target.value ? openHazard(event.target.value) : clearHazard()}>
        <option value="">All hazards</option>{catalogue.domains.map(domain => { const symbol = hazardSymbol(domain.name); return <option key={domain.number} value={symbol}>{domain.name}</option>; })}
      </select></label>
    </div>
  </section>;
  if (authCallback && !token) return <SignInScreen dispatch={dispatch} />;
  return <div data-ui-formulation={`${PAGE_LAYOUT.id}/${PAGE_LAYOUT.version}`} data-sop={PAGE_LAYOUT.sop} className={`regional-app chat-workspace-shell ${view === 'dashboard' ? 'chat-map-home regional-flow-mode' : commandCenter ? 'chat-map-home command-center-page regional-flow-mode' : ''} ${mobileNavigation?'mobile-spatial':''} mobile-sheet-${sheetState} ${previewHero ? 'is-preview-hero' : ''} ${dockCollapsed ? 'chat-is-collapsed' : ''} ${navCollapsed ? 'nav-is-collapsed' : ''}`} style={{ '--navigation-width': navCollapsed ? '12px' : `${PAGE_LAYOUT.navigationWidth}px`, ...(previewHero && previewWidth ? { '--preview-hero-width': `${previewWidth}px` } : {}), '--desktop-columns': dockCollapsed ? `${navCollapsed ? 12 : PAGE_LAYOUT.navigationWidth}px minmax(0,1fr) 24px 0` : `${navCollapsed ? 12 : PAGE_LAYOUT.navigationWidth}px ${panelResized?`minmax(0,${split}fr) 8px minmax(260px,${100-split}fr)`:`minmax(0,1fr) 8px ${PAGE_LAYOUT.chatWidth}px`}` } as CSSProperties}>
    <a className="dashboard-skip" href="#dashboard-main">Skip to dashboard</a>
    {(view!=='dashboard'||mobileNavigation)&&<SiteHeader onMenu={mobileNavigation?toggleNavigation:undefined}>{view!=='dashboard'&&!commandCenter&&regionSelector}{mobileNavigation&&<button className="dashboard-profile" aria-label={demo?'Guest preview: sign in':`Account: ${state.session?.user.displayName}`} onClick={()=>{if(demo)setLogin(true);else{setMenu(true);setTimeout(()=>document.querySelector<HTMLButtonElement>('.sidebar-account')?.click(),0);}}}><span className="profile-avatar">{state.session?.user.displayName.slice(0,1)??'G'}</span><span><strong>{state.session?.user.displayName??'Guest preview'}</strong><small>{state.session?.user.role??'Sign in to your workspace'}</small></span></button>}</SiteHeader>}
    <div className="dashboard-body">
      {menu && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenu(false)}/>}
      <WorkspaceSidebar current={view} onViewChange={changeView} open={menu} hidden={!navigationShown} admin={state.session?.user.isAdmin} incidentCount={incidents.length} chatSession={state.session} account={<AccountMenu session={state.session} onSignIn={()=>setLogin(true)} onSignOut={()=>dispatch({type:'session',session:null})}/>}/>

      <div className={`dashboard-content-layout ${dockCollapsed ? 'dock-collapsed' : ''}`} style={{ '--workspace-share': split, gridTemplateColumns: dockCollapsed ? 'minmax(0, 1fr) 0 56px' : panelResized?`minmax(0, ${split}fr) 8px minmax(260px, ${100 - split}fr)`:`minmax(0,1fr) 8px ${PAGE_LAYOUT.chatWidth}px` } as CSSProperties}><main id="dashboard-main" className="dashboard-main" tabIndex={-1}>
        {view === 'dashboard' ? <h1 className="sr-only">Regional operations</h1> : commandCenter ? <h1 className="sr-only">AEGIS Incident Command Center</h1> : <div className="dashboard-page-heading"><div><div className="eyebrow">AEGIS / REGIONAL INTELLIGENCE</div><h1>{view === 'incident' && hazardFilter ? `${hazardFilter.charAt(0).toUpperCase()}${hazardFilter.slice(1)} incidents` : navigation.find(item => item.id === view)?.label ?? 'Cards'}</h1><p>Inspect records, sources and revisions in one consistent card workspace.</p></div><div className="dashboard-heading-actions"><button className="ui-button dashboard-refresh" onClick={() => demo ? setLogin(true) : setRefresh(value => value + 1)} disabled={state.loading.cards}><Icon name={demo ? 'arrow' : 'refresh'} size={16}/>{demo ? 'Connect workspace' : 'Refresh cards'}</button></div></div>}
        {view !== 'dashboard' && !commandCenter && <div className={`dashboard-source-banner ${demo ? 'is-demo' : ''}`}><span><Icon name={demo ? 'layers' : 'shield'} size={16}/><strong>{sourceLabel}</strong><span>{demo ? 'Illustrative scenarios. Not current disaster information.' : 'Tenant-scoped cards. Unavailable regional metrics stay unknown.'}</span></span><small>{demo ? `Snapshot ${dateText(DEMO_AS_OF)}` : loadedAt ? `Retrieved ${dateText(loadedAt)}` : 'Awaiting system records'}</small></div>}
        {region && countryPending && <p className="dashboard-footnote" role="status">Country classification is missing on some workspace cards. They are excluded from country filters until supplied by the backend.</p>}
        {state.loading.cards && <span role="status" className="sr-only">Loading system cards…</span>}
        {state.errors.cards && <div className="dashboard-error" role="alert">{state.errors.cards}<button onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
        {view === 'dashboard' ? <>
          <div className="regional-map-stage"><section className="dashboard-card map-panel" data-card-kind="module" data-card-id="module:asean-regional-overview" aria-label="ASEAN regional overview"><RegionalMap operational={canUseOperationalTools({plan:state.session?.user.plan==='pro'?'pro':'standard',isAdmin:state.session?.user.isAdmin===true})} timelineControl={timelineControl} cards={dashboardMapCards} onOpen={openCard} overviewExpanded={true} country={region} regionControl={regionSelector}/></section></div>
          <section className="dashboard-summary-section" aria-label="Regional summary section"><header className="regional-summary-heading"><h2>Regional summary</h2><span className="regional-summary-divider" aria-hidden="true">|</span><p className="regional-summary-subtitle">Telemetry aggregated across verified ASEAN disaster monitoring feeds (Last 14 Days)</p></header><section className="dashboard-metrics" id="regional-summary" data-card-kind="section" data-card-id="section:regional-summary" aria-label="Regional summary">{metrics.map((metric, metricIndex) => <div className={`dashboard-card metric-card tone-${metric.tone}${metricIndex >= metrics.length - 2 ? ' metric-popover-end' : metricIndex === 0 ? ' metric-popover-start' : ''}`} data-card-kind="module" data-card-id={`metric:${metric.title.toLowerCase().replaceAll(' ','-')}`} key={metric.title} tabIndex={0} aria-describedby={`metric-tooltip-${metric.title.toLowerCase().replaceAll(' ', '-')}`} onMouseEnter={() => setActiveMetricDetails(metric.title)} onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) setActiveMetricDetails(null); }} onFocus={() => setActiveMetricDetails(metric.title)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !event.currentTarget.matches(':hover')) setActiveMetricDetails(null); }}><div className="metric-top"><span className="metric-icon"><Icon name={metric.icon}/></span><span className="metric-tags"><span className="metric-source">{metric.tag ?? (metric.target ? sourceLabel : showDemo && !['Not assessed', 'Unknown'].includes(metric.value) ? 'Demo stub' : 'Pending')}</span>{showDemo && metric.demoOnly && <span className="metric-demo-badge">DEMO</span>}</span></div><strong className={metric.value.length > 8 ? 'metric-value metric-text' : 'metric-value'}>{metric.value}</strong><span className="metric-label">{metric.title}</span><small>{metric.note}</small><div id={`metric-tooltip-${metric.title.toLowerCase().replaceAll(' ', '-')}`} className={`metric-detail-popover${activeMetricDetails === metric.title ? ' is-visible' : ''}`} role="tooltip" aria-hidden={activeMetricDetails !== metric.title}><strong>{metric.title}: where this comes from</strong><p>{provenanceOf(metric.title)}</p><small>{metric.tag ?? sourceLabel}</small></div></div>)}</section></section>
          <div className="regional-info-tray" id="regional-overview-info" role="region" aria-label="Regional overview information" tabIndex={0}>
            <div className="dashboard-detail-grid"><div className="dashboard-detail-column dashboard-detail-column-primary"><Panel title="Latest card updates" action={<span className="neutral-badge">{showDemo ? 'Synthetic' : demo ? 'Reported' : 'System'}</span>}><div className="latest-updates">{filtered.slice(0, 2).map((item) => <button key={item.card.cardId} onClick={() => openCard(item)}><span className={`update-line tone-${hazardTone(hazardName(item))}`}/><span><strong>{item.card.title}</strong><small>{dateText(item.card.createdAt)} · r{item.card.revision}</small></span><Icon name="arrow" size={14}/></button>)}{!filtered.length && <p className="dashboard-footnote">No card updates available.</p>}</div></Panel>
              <Panel title="Incident activity" eyebrow="RECORDED INCIDENTS" action={<span className="neutral-badge">USGS / GDACS</span>}><IncidentTrend data={trend} loading={trendLoading} error={trendError} onRetry={() => setTrendRetry(value => value + 1)}/></Panel>
              <Panel title="Resource readiness" eyebrow="SUPPORT ON THE GROUND" action={resourceCards.length === 0 ? <span className="stub-badge">Phase 2</span> : <button className="text-action" onClick={() => changeView('resource')}><Icon name="arrow" size={16}/><span className="sr-only">View resource cards</span></button>}>{resourceCards.length === 0 ? <><div className="readiness-hero"><span className="readiness-icon"><Icon name="box" size={32}/></span><div><strong>Planned for Phase 2</strong><p>Relief resources traced to their source. No data source is connected yet, so nothing is shown rather than a guess.</p></div></div><div className="readiness-row"><span>Resource inventory</span><span className="stub-badge">Phase 2</span></div><div className="readiness-row"><span>Deployment status</span><span className="stub-badge">Phase 2</span></div><div className="readiness-row"><span>Transport tracking</span><span className="stub-badge">Phase 2</span></div></> : <><div className="readiness-hero"><span className="readiness-icon"><Icon name="box" size={32}/></span><div><strong>{pending ? '—' : resourceCards.length} resource cards</strong><p>Trace availability to its source.</p></div></div><div className="readiness-row"><span>Deployment status</span><span className="neutral-badge">Not connected</span></div><div className="readiness-row"><span>Transport tracking</span><span className="neutral-badge">Not connected</span></div></>}</Panel></div><div className="dashboard-detail-column dashboard-detail-column-secondary"><Panel title="Recent incidents" eyebrow="SITUATION ROOM" action={<button className="text-action" onClick={() => changeView('incident')}>All cards <Icon name="arrow" size={15}/></button>}>{collection(incidents.slice(0, 5), true)}</Panel></div>
            </div>{pinnedContent}
          </div>
        </> : commandCenter ? <>
          {commandCenterControls}
          <FeaturedHazards incidents={incidents} demo={demo} pending={pending} activeHazard={hazardFilter} onOpen={openHazard}/>
          <section className="command-center-feed" aria-label="Incident command feed">
            {feedMode === 'history' && <section className="command-center-archive" aria-label="Historical archive filters, timeline and search">
              <h3>Historical archive filters, timeline &amp; search</h3>
              <HazardHistory domain={domainNumberForSymbol(hazardFilter)} showDomainChips={!hazardFilter} selectedRangeMs={activeHistoryRange} onSelectedRangeMsChange={setHistoryRange} selectedCardId={historyFocusId}/>
            </section>}
            {feedMode === 'live' && <>
              <Panel className="command-center-live-panel" title="Live incident feed" action={<>{hazardFilter && <div className="command-center-filter-inline" role="status"><span>{'\u2190'} Showing {hazardLabel(hazardFilter)} ({activeLiveIncidents.length})</span><button type="button" onClick={clearHazard}>Clear Filter</button></div>}<span className="neutral-badge">{sourceLabel}</span></>}>
                {collection(activeLiveIncidents.slice(activeFeedPage * pageSize, (activeFeedPage + 1) * pageSize), true)}
              </Panel>
              {feedPageCount > 1 && <nav className="command-center-pagination" aria-label="Live incident pages">
                <button type="button" className="ui-button" disabled={activeFeedPage === 0} onClick={() => setIncidentPage(activeFeedPage - 1)}>{'\u2039'} Previous</button>
                {Array.from({length:feedPageCount}, (_, page) => <button type="button" key={page} className={page === activeFeedPage ? 'ui-button is-current' : 'ui-button'} aria-current={page === activeFeedPage ? 'page' : undefined} onClick={() => setIncidentPage(page)}>{page + 1}</button>)}
                <button type="button" className="ui-button" disabled={activeFeedPage + 1 >= feedPageCount} onClick={() => setIncidentPage(activeFeedPage + 1)}>Next {'\u203A'}</button>
              </nav>}
            </>}
            <details className="command-center-sources"><summary>{'\u24D8'} View Data Sources</summary><p>Each incident card includes its source and publication details. Live Feed shows records classified as current; archive coverage and classification vary by source. Synthetic demo counts are illustrative, not current disaster reports. Map pins show reported coordinates, not an impact boundary unless a card says otherwise.</p></details>
          </section>
        </> : view === 'communities' || view === 'reports' ? <Panel title={view === 'communities' ? 'Community intelligence' : 'Situation reports'} action={<span className="stub-badge">Backend pending</span>}><div className="dashboard-empty"><Icon name={view === 'communities' ? 'people' : 'report'} size={40}/><strong>{view === 'communities' ? 'Community registry is next' : 'Evidence-backed reporting starts with cards'}</strong><p>{view === 'communities' ? 'Population, vulnerability and location cards will appear here once the registry is connected.' : 'Open incident cards and explicitly attach their revisions to Assist. Automated report export is planned.'}</p><button className="ui-button" onClick={() => changeView('incident')}>Explore incident cards <Icon name="arrow" size={16}/></button></div></Panel> : view === 'incident' && hazardFilter ? <div className="hazard-incident-sections"><button className="text-action" onClick={() => changeView('incident')}>All incidents</button><Panel title="Current incidents" action={<span className="neutral-badge">{sourceLabel}</span>}>{collection(listCards.slice(activePage * pageSize, (activePage + 1) * pageSize))}</Panel>{incidents.some(item => hazardSymbol(hazardName(item)) === hazardFilter && !['current','historical'].includes(String(field(item.card, 'incidentPeriod')))) && <Panel title="Classification pending">{collection(incidents.filter(item => hazardSymbol(hazardName(item)) === hazardFilter && !['current','historical'].includes(String(field(item.card, 'incidentPeriod')))))}</Panel>}<Panel title="Historical incidents" action={<span className="neutral-badge">Source-backed backfill</span>}><HazardHistory domain={domainNumberForSymbol(hazardFilter)}/>{incidents.some(item => hazardSymbol(hazardName(item)) === hazardFilter && field(item.card, 'incidentPeriod') === 'historical') && <div className="workspace-historical"><h4>Also in this workspace</h4>{collection(incidents.filter(item => hazardSymbol(hazardName(item)) === hazardFilter && field(item.card, 'incidentPeriod') === 'historical'))}</div>}</Panel></div> : <Panel title={`${navigation.find((item) => item.id === view)?.label ?? 'Assessment'} cards`} action={<span className="neutral-badge">{sourceLabel}</span>}>{collection(view === 'incident' ? listCards.slice(activePage * pageSize, (activePage + 1) * pageSize) : listCards)}</Panel>}
        {!commandCenter && view !== 'dashboard' && pinnedContent}
      {!commandCenter && view === 'incident' && pageCount > 1 && <nav className="incident-pagination" aria-label="Incident pages"><button className="ui-button" disabled={activePage === 0} onClick={() => setIncidentPage(activePage - 1)}>Previous</button><span role="status">{activePage * pageSize + 1}–{Math.min((activePage + 1) * pageSize, listCards.length)} of {listCards.length} incidents</span><button className="ui-button" disabled={activePage + 1 >= pageCount} onClick={() => setIncidentPage(activePage + 1)}>Next</button></nav>}</main><Divider value={split} onChange={resizePanels}/><aside className={`dashboard-assist ${assist ? 'assist-open' : ''}`} data-card-kind="module" data-card-id="dock:assistant" id="aegis-assistant" aria-label="AEGIS Assist" aria-hidden={!assistantShown} inert={!assistantShown} data-sheet-state={sheetState}>{mobileNavigation&&<MobileSheetHandle state={sheetState} onChange={changeSheet} onNews={()=>{changeSheet('half');window.dispatchEvent(new CustomEvent('aegis-play-latest-news'));}}/>}<div className="mobile-sheet-content" inert={mobileNavigation&&sheetState==='peek'} aria-hidden={mobileNavigation&&sheetState==='peek'}><ChatDock messages={chatWorkspace.messages} attachments={state.attachments} onClose={toggleAssistant}>{demo && <div className="assist-signin"><p>Sign in to chat with your workspace. Demo cards stay separate from system records.</p><button className="ui-button ui-button-primary" onClick={() => setLogin(true)}>Sign in to chat <Icon name="arrow" size={16}/></button></div>}<ChatPanel helper onAttachCard={(cardId,revision)=>dispatch({type:'toggle-attachment',cardId,revision})} token={token ?? null} cards={cards.map((item) => item.card)} attachments={state.attachments} messages={chatWorkspace.messages} suggestions={['Summarize sector hazards', 'Find nearby help and hospitals', 'Drop a pin to check this location']} onRemoveAttachment={(cardId) => dispatch({ type: 'toggle-attachment', cardId, revision: 1 })} onAddMessage={(message) => dispatch({ type: 'chat-message', ...message })} onClearAttachments={() => dispatch({ type: 'clear-attachments' })} onOpenCard={(cardId, revision) => { const card = state.cards.find((item) => item.card.cardId === cardId); const requested = card?.revisions.find((item) => item.revision === revision); if (card && requested) openCard({ ...card, card: requested }); else setNotice('The requested card revision is not available. Refresh cards and try again.'); }}/></ChatDock></div></aside></div>
    </div>
    <PanelPuller side="navigation" expanded={navigationShown} onToggle={toggleNavigation}/>
    <PanelPuller side="assistant" expanded={assistantShown} onToggle={toggleAssistant}/>
    {login && <Modal title="Sign in to AEGIS" className="signin-dialog" onClose={() => setLogin(false)}><SignInScreen dispatch={dispatch}/></Modal>}
    {selected && <Modal portrait title="Card details & evidence" onClose={() => { setSelected(null); setNotice(''); }}><CardView key={`${selected.card.cardId}-${selected.card.revision}`} {...selected} pinned={state.pins.includes(selected.card.cardId)} attached={state.attachments.some((item) => item.cardId === selected.card.cardId)} onPin={() => void togglePin(selected)} onAttach={(revision) => {
      if (!token) { setNotice('Sign in to attach system cards. Synthetic preview cards cannot be sent to chat.'); return; }
      const alreadyAttached = state.attachments.some((item) => item.cardId === selected.card.cardId);
      if (!alreadyAttached && state.attachments.length >= 5) { setNotice('Attach up to five cards per message.'); return; }
      dispatch({ type: 'toggle-attachment', cardId: selected.card.cardId, revision });
      setNotice(alreadyAttached ? 'Card removed from chat context.' : `Revision ${revision} attached to your next chat message.`);
    }} feedback={notice && <p role="status" className="card-feedback">{notice}</p>} footer={<button className="ui-button ui-button-primary" onClick={() => { setSelected(null); setNotice(''); }}>Close</button>}/></Modal>}
    {notice && !selected && <div className="dashboard-toast" role="status">{notice}<button className="ui-icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
  </div>;
}
