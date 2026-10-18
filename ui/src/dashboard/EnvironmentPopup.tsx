import { useEffect, useState } from 'react';
import { CardDialog } from '../components/CardDialog.js';
import { monitoringCardLayout } from '../formulations/pageTemplates.js';
import { airMonitored, currentReading, record, temperature, type EnvPinView, type EnvReading, type EnvironmentUpdates } from './environment.js';
import { FreshnessBadge } from './FreshnessBadge.js';
import { deadlineOf } from './freshness.js';
import { Icon } from './Icon.js';
import { HazardIcon } from '../components/HazardIcon.js';
import './environment.css';

const DASH = '\u2014';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown) => typeof value === 'string' ? value : null;
const timeMYT = (at?: string | null) => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleTimeString('en-GB', { timeZone:'Asia/Kuala_Lumpur', hour:'2-digit', minute:'2-digit' }) : DASH;

function Credit({ reading, fallback }: { reading: EnvReading | null; fallback: string }) {
  return <div className="environment-credit"><p>{reading?.attribution ?? fallback}</p>{reading?.freshness?.text && <details><summary>Source timing</summary><p>{reading.freshness.text}</p><p>{reading.freshness.cadence}</p></details>}</div>;
}

type PsiData = { reading: { observedAt:string; updatedAt:string; regions:{region:string;psi:number;band:string;pm25_24h:number|null}[] } | null; attribution:string };
const psiRegions = [{ region:'north',lat:1.418,lng:103.82 },{ region:'south',lat:1.296,lng:103.82 },{ region:'east',lat:1.357,lng:103.94 },{ region:'west',lat:1.357,lng:103.70 },{ region:'central',lat:1.357,lng:103.82 }];
function SingaporePsi({ pin }: { pin:EnvPinView }) {
  const [data,setData] = useState<PsiData|null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => { try { const response = await fetch('/public/air/psi',{signal:abort.signal,cache:'no-store'}); if (!response.ok) throw new Error(); const value = await response.json() as PsiData; if(!abort.signal.aborted) setData(value); } catch { if(!abort.signal.aborted) setData(null); } };
    void load(); const timer = window.setInterval(() => void load(),60_000);
    return () => { abort.abort(); clearInterval(timer); };
  }, []);
  const nearest = [...psiRegions].sort((a,b) => ((pin.lat-a.lat)**2+(pin.lng-a.lng)**2)-((pin.lat-b.lat)**2+(pin.lng-b.lng)**2))[0]!;
  const reading = data?.reading?.regions.find(item => item.region === nearest.region);
  return <section className="environment-psi" aria-label="Singapore NEA PSI"><h4>NEA 24-hour PSI</h4>{reading ? <><p className="environment-value"><strong>{reading.psi}</strong> <span>{reading.band}</span></p><p>{nearest.region} region {'\u00b7'} Regional reading, not a measurement at this pin</p><p>Updated {timeMYT(data?.reading?.updatedAt)} MYT (hourly)</p>{reading.pm25_24h !== null && <p>PM2.5 (24-hour): {reading.pm25_24h} {'\u00b5g/m\u00b3'}</p>}</> : <p>{DASH} {'\u00b7'} Not available</p>}{data?.attribution && <p className="environment-credit">{data.attribution}</p>}</section>;
}

function PlacePhoto({ pin }: { pin:EnvPinView }) {
  const [failed,setFailed] = useState(false);
  const media = pin.media;
  const image = media?.image;
  return <figure className="environment-place-photo">
    {image && !failed ? <img src={image.thumb250} srcSet={`${image.thumb250} 250w, ${image.thumb500} 500w`} sizes="175px" width={image.width} height={image.height} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <div className="environment-photo-fallback" role="img" aria-label="Monitoring location illustration"><Icon name="pin" size={32}/></div>}

  </figure>;
}

function PhotoCredit({ pin }: { pin:EnvPinView }) {
  const media = pin.media;
  const image = media?.image;
  return <div className="environment-photo-credit">    {image && <><a href={image.commonsUrl} target="_blank" rel="noreferrer">{image.credit}</a>{image.licenceUrl && <> {'\u00b7'} <a href={image.licenceUrl} target="_blank" rel="noreferrer">{image.licence}</a></>}</>}{media?.wikipediaUrl && <a className="environment-wikipedia" href={media.wikipediaUrl} target="_blank" rel="noreferrer">Read more on Wikipedia {'\u2197'}</a>}</div>;
}

function Metric({ label, value, unit }: { label:string;value:number|null;unit?:string }) {
  return <div className="environment-metric"><span>{label}</span><strong>{value ?? DASH}{value !== null && unit && <small> {unit}</small>}</strong></div>;
}

type PinHistory = { measured: { value:number; unit:string; observedAt:string; stationName:string; distanceKm:number; provider:string|null; licence:string|null; credit:string; note:string } | null; credit:string; link:string; days: { date:string; tempMin:number|null; tempMax:number|null; rainMm:number; pm25Max:number|null; hours:number }[] };
/** Seven days of Open-Meteo MODELLED values (stored, CC BY 4.0) and the nearest measured OpenAQ station. Not Google data, so it stays after the one-hour limit. */
function PinTrend({ pin }: { pin:EnvPinView }) {
  const [data,setData] = useState<PinHistory|null>(null);
  useEffect(() => {
    const abort = new AbortController(); setData(null);
    if (pin.pinId.startsWith('cust-')) return () => abort.abort();   // a dropped pin has no stored history (no 404 to ask)
    fetch(`/public/environment/pin/${pin.pinId}/history`,{signal:abort.signal}).then(r=>r.ok?r.json():null).then(v=>{ if(!abort.signal.aborted) setData(v as PinHistory|null); }).catch(()=>{ if(!abort.signal.aborted) setData(null); });
    return () => abort.abort();
  }, [pin.pinId]);
  const fmt = (v:number|null) => v===null ? DASH : String(Math.round(v*10)/10);
  return <section className="environment-card-section" aria-label="Last 7 days"><h4>Last 7 days<span className="environment-radius">modelled</span></h4>
    {!data || data.days.length===0 ? <p>{DASH} {'\u00b7'} Not available yet</p> : <table className="environment-trend"><thead><tr><th>Day</th><th>Temp {'\u00b0'}C</th><th>Rain mm</th><th>PM2.5 max</th></tr></thead><tbody>{data.days.filter(d=>d.hours>=12).map(d=><tr key={d.date}><td>{d.date.slice(5)}</td><td>{fmt(d.tempMin)}{'\u2013'}{fmt(d.tempMax)}</td><td>{fmt(d.rainMm)}</td><td>{fmt(d.pm25Max)}</td></tr>)}</tbody></table>}
    {data?.measured && <p className="environment-measured">Measured nearby: PM2.5 {fmt(data.measured.value)} {'\u00b5'}g/m{'\u00b3'} at {data.measured.stationName} ({data.measured.distanceKm} km), {timeMYT(data.measured.observedAt)} MYT{data.measured.provider ? `, ${data.measured.provider}` : ''}{data.measured.licence ? `, ${data.measured.licence}` : ''}. {data.measured.note}</p>}
    <small>{data ? <>{data.credit} <a href={data.link} target="_blank" rel="noreferrer">open-meteo.com</a>. {data.measured ? data.measured.credit : ''}</> : 'Modelled values are not station readings.'}</small></section>;
}

export function EnvironmentPopup({ pins, attribution, updates, onSelect, onClose, onDemand = false, onRefresh, refreshLabel }: { pins: EnvPinView[]; attribution?:{air:string;weather:string}; updates?:EnvironmentUpdates; onSelect:(id:string)=>void; onClose:()=>void; onDemand?: boolean; onRefresh?: (pinId: string) => Promise<string | null>; refreshLabel?: string }) {
  const pin = pins.length === 1 ? pins[0]! : null;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');
  const refresh = (): void => { if (!pin || !onRefresh) return; setRefreshing(true); setRefreshNote(''); void onRefresh(pin.pinId).then((msg) => setRefreshNote(msg ?? '')).finally(() => setRefreshing(false)); };
  const isDemo = pin ? [pin.air, pin.weather.current].some((r) => r?.data?.['demo'] === true) : false;   // admin sample data, never Google
  const deadline = pin && pin.readingState !== 'never' ? deadlineOf(pin.lastUpdatedAt, pin.air?.validUntil ?? pin.weather.current?.validUntil) : NaN;
  const air = pin && airMonitored(pin) && pin.readingState !== 'expired' && pin.readingState !== 'never' ? currentReading(pin.air) : null;
  const weather = pin && pin.readingState !== 'expired' && pin.readingState !== 'never' ? currentReading(pin.weather.current) : null;
  const alerts = pin && pin.readingState !== 'expired' && pin.readingState !== 'never' ? currentReading(pin.weather.alerts) : null;
  const indexes = (Array.isArray(air?.data.indexes) ? air.data.indexes : []).map(record).filter((item): item is Record<string,unknown>=>item!==null && number(item.aqi)!==null);
  const preferred = indexes.find(item=>item.code!=='uaqi') ?? indexes[0];
  const pollutants = (Array.isArray(air?.data.pollutants) ? air.data.pollutants : []).map(record);
  const pollutant = (code:string) => { const concentration = record(pollutants.find(item=>item?.code===code)?.concentration); return concentration?.units==='MICROGRAMS_PER_CUBIC_METER' ? number(concentration.value) : null; };
  const degrees = temperature(weather);
  const condition = record(weather?.data.weatherCondition);
  const description = text(record(condition?.description)?.text);
  const wind = record(record(weather?.data.wind)?.speed);
  const feels = record(weather?.data.feelsLikeTemperature);
  const alertRows = alerts && Array.isArray(alerts.data.alerts) ? alerts.data.alerts.map(record).filter(item=>item!==null) : [];
  const noAlertSource = pin?.country==='MY' || pin?.country==='BN' || alerts?.data.unsupported===true;
  const nearby = pin?.nearby;
  const footerAt = pin?.lastUpdatedAt ?? weather?.fetchedAt ?? air?.fetchedAt;
  const airCredit = attribution?.air ?? 'Source: Includes air quality data from Google';
  const weatherCredit = attribution?.weather ?? 'Source: Includes weather data from Google';
  if(!pin)return <CardDialog title="Air and weather locations" closeLabel="Close air and weather" onClose={onClose} className="environment-card-dialog">
    <h3>{pins.length} monitoring locations</h3><ul className="environment-location-list">{pins.map(item=><li key={item.pinId}><button className="ui-button" onClick={()=>onSelect(item.pinId)}>{item.name} {'\u00b7'} {item.country}</button></li>)}</ul>
  </CardDialog>;
  return <CardDialog portrait title={`Air and weather: ${pin.name}`} closeLabel="Close air and weather" onClose={onClose} className="environment-card-dialog">
    <article className="card-view environment-standard-card" data-card-kind="module" data-card-id="environment:place" data-ui-formulation={`${monitoringCardLayout.id}/${monitoringCardLayout.version}`}>
      <PlacePhoto key={pin.pinId} pin={pin}/>
      <header className="card-header"><div><h2>{pin.name}</h2><p>{pin.region} {'\u00b7'} {pin.country} {'\u00b7'} Monitoring location</p></div></header>
      {pin.unverified && <p className="environment-review">Location review pending: {pin.unverified}</p>}
      <FreshnessBadge deadline={Number.isFinite(deadline) ? deadline : null} demo={isDemo} canRefresh={onDemand && onRefresh !== undefined && !isDemo} busy={refreshing} onRefresh={refresh} note={refreshNote}{...(refreshLabel ? { refreshLabel } : {})}/>
      <div className="environment-summary" aria-label="Location summary">
        <div><span className="environment-section-icon air"><Icon name="leaf" size={20}/></span><span className="environment-summary-content"><span className="environment-summary-label">Air</span><small className="environment-summary-qualifier">{preferred ? text(preferred.displayName) ?? text(preferred.code) ?? 'AQI' : null}</small><strong>{preferred ? number(preferred.aqi) : DASH}</strong><small>{!airMonitored(pin) ? 'Air quality not monitored here' : text(preferred?.category) ?? 'Not available'}</small></span></div>
        <div><span className="environment-section-icon weather"><Icon name="cloud" size={20}/></span><span className="environment-summary-content"><span className="environment-summary-label">Weather</span><small className="environment-summary-qualifier" aria-hidden="true"/><strong>{degrees ?? DASH}</strong><small>{description ?? 'Not available'}</small></span></div>
        <div><span className="environment-section-icon disaster"><Icon name="alert" size={20}/></span><span className="environment-summary-content"><span className="environment-summary-label">Disaster</span><small className="environment-summary-qualifier" aria-hidden="true"/><strong>{nearby?.total ?? DASH}</strong><small>{nearby ? `Recorded within ${nearby.radiusKm} km` : 'Not available'}</small></span></div>
      </div>
      <section className="environment-card-section" aria-label="Air quality"><h4><span className="environment-section-icon air"><Icon name="leaf"/></span>Air Quality</h4>
        {!airMonitored(pin) ? <p className="environment-missing">Air quality not monitored here</p> : indexes.length ? <div className="environment-indexes">{indexes.map((index,i)=><div className="environment-index" key={text(index.code)??i}><span>{text(index.displayName) ?? text(index.code) ?? 'AQI'}</span><strong className="environment-value">{number(index.aqi)}</strong><span className="environment-category">{text(index.category) ?? 'Category not supplied'}</span></div>)}</div> : <p className="environment-missing">{DASH} {'\u00b7'} Not available</p>}
        {airMonitored(pin) && <div className="environment-pollutants"><Metric label="PM2.5" value={pollutant('pm25')} unit={'\u00b5g/m\u00b3'}/><Metric label="PM10" value={pollutant('pm10')} unit={'\u00b5g/m\u00b3'}/></div>}
        <Credit reading={air} fallback={airCredit}/>
        {pin.country==='SG' && <SingaporePsi pin={pin}/>}
      </section>
      <section className="environment-card-section" aria-label="Current weather"><h4><span className="environment-section-icon weather"><Icon name="cloud"/></span>Current Weather</h4>
        <div className="environment-weather-grid"><div className="environment-temperature">{weather && degrees!==null ? <><strong className="environment-value">{degrees}</strong>{description && <span>{description}</span>}</> : <><strong>{DASH}</strong><span>Not available</span></>}</div><div className="environment-weather-metrics"><Metric label="Humidity" value={number(weather?.data.relativeHumidity)} unit="%"/><Metric label="Wind" value={wind?.unit==='KILOMETERS_PER_HOUR' ? number(wind.value) : null} unit="km/h"/><Metric label="Feels like" value={feels?.unit==='CELSIUS' ? number(feels.degrees) : null} unit={'\u00b0C'}/></div></div>
        <Credit reading={weather} fallback={weatherCredit}/>
        <details className="environment-alert-details"><summary>Weather alerts</summary><section aria-label="Weather alerts">{noAlertSource ? <p>No Google alert source for this country</p> : alerts ? <>{alertRows.length ? <ul>{alertRows.map((item,i)=><li key={i}>{text(item.alertTitle)??'Alert details not supplied'}</li>)}</ul> : <p>No alert entries returned by Google for this point; this does not establish safe conditions.</p>}<Credit reading={alerts} fallback={weatherCredit}/></> : <p>{DASH} {'\u00b7'} Not available</p>}</section></details>
      </section>
      <PinTrend pin={pin}/>
      <section className="environment-card-section" aria-label="Disaster alerts"><h4><span className="environment-section-icon disaster"><Icon name="alert"/></span>Disaster Alerts<span className="environment-radius">within {nearby?.radiusKm ?? 100} km</span></h4>
        <p className="environment-nearby-total">{nearby ? `${nearby.total} current incidents recorded by live feeds` : `${DASH} \u00b7 Not available`}</p>
        <div className="environment-hazard-counts">{(['earthquake','flood','storm','wildfire'] as const).map(hazard=><div key={hazard}><HazardIcon hazard={hazard} size={20}/><span>{hazard}</span><strong>{nearby?.counts[hazard] ?? DASH}</strong></div>)}</div>
        <details className="environment-nearby-details"><summary>View details</summary><p>{nearby?.note ?? 'Nearby live-feed incident coverage is not available.'}</p>{nearby?.items.map((item,i)=><p key={i}>{item.title} {'\u00b7'} {item.distanceKm} km {'\u00b7'} {item.sourceId}</p>)}</details>
      </section>

    </article>
    <footer className="card-dialog-footer environment-standard-footer"><div>Last updated {timeMYT(footerAt)} MYT {'\u00b7'} Updated {updates?.perDay ?? 4} times a day ({(updates?.timesLocal ?? ['07:00','12:00','17:00','22:00']).join(', ')})<small>Values are shown for one hour after each update</small><div className="environment-persistent-sources">{airCredit}<br/>{weatherCredit}</div><PhotoCredit pin={pin}/></div></footer>
  </CardDialog>;
}
