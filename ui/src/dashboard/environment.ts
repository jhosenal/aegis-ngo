import { useEffect, useState } from 'react';
import type { EnvPinView as StoredPin, EnvRunStatus } from '../../../src/services/envStore.js';
import type { EnvReading } from '../../../src/sources/googleEnv.js';

import type { PlaceMediaView } from '../../../src/services/placeMedia.js';
import type { Nearby } from '../../../src/services/nearby.js';
import pinRegistry from '../../../fixtures/environment-pins.json' with { type: 'json' };
export type EnvPinView = StoredPin & { media?: PlaceMediaView | null; nearby?: Nearby | null; needs?: string[] };
export type { EnvReading };
export const airMonitored = (pin: EnvPinView) => (pin.needs ?? pinRegistry.pins.find(item => item.pinId === pin.pinId)?.needs ?? ['air']).includes('air');
export interface EnvironmentUpdates { perDay: number; timesLocal: string[]; timezone: string; valueShownMinutes: number }

export interface EnvironmentData {
  asOf: string; status: EnvRunStatus; sample?: boolean; demoActive?: boolean; onDemand?: { enabled: boolean }; attribution: { air: string; weather: string };
  updates?: EnvironmentUpdates;
  registry: { id: string; asOf: string; pins: number }; pins: EnvPinView[]; remarks: string[];
}

/** Missing/invalid deadlines fail closed. Never retain a value beyond either its deadline or one hour from retrieval. */
export function readingDeadline(reading: EnvReading | null): number {
  if (!reading) return NaN;
  return Math.min(Date.parse(reading.validUntil), Date.parse(reading.fetchedAt) + 3_600_000);
}
export function currentReading(reading: EnvReading | null, now = Date.now()): EnvReading | null {
  return reading && readingDeadline(reading) > now ? reading : null;
}
function purge(data: EnvironmentData, now = Date.now()): EnvironmentData {
  return { ...data, pins: data.pins.map(pin => ({ ...pin, air: currentReading(pin.air, now), weather: {
    current: currentReading(pin.weather.current, now), hourly: currentReading(pin.weather.hourly, now), alerts: currentReading(pin.weather.alerts, now),
  } })) };
}

/** Local read route only. No Google/provider requests, browser storage, service-worker cache or persistent readings. */
export function useEnvironmentLayer(enabled: boolean, sample = false) {
  const [data, setData] = useState<EnvironmentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) { setData(null); setLoading(false); setError(false); return; }
    let active = true; let pending = false;
    const abort = new AbortController();
    const load = async () => {
      if (pending) return;
      pending = true; setLoading(true);
      try {
        const response = await fetch(sample ? '/public/environment?sample=1' : '/public/environment', { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error('Environment route unavailable');
        const result = await response.json() as EnvironmentData;
        if (!Array.isArray(result.pins)) throw new Error('Environment pins unavailable');
        if (active) { setData(purge(result)); setError(false); }
      } catch { if (active) setError(true); }
      finally { pending = false; if (active) setLoading(false); }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 60_000);
    return () => { active = false; abort.abort(); clearInterval(interval); };
  }, [enabled, retry, sample]);
  useEffect(() => {
    if (!data) return;
    const deadlines = data.pins.flatMap(pin => [pin.air, pin.weather.current, pin.weather.hourly, pin.weather.alerts]).filter((r): r is EnvReading => r !== null).map(readingDeadline);
    const expire = () => setData(value => value ? purge(value) : null);
    const timer = deadlines.length ? window.setTimeout(expire, Math.max(1, Math.min(...deadlines) - Date.now() + 1)) : null;
    // Background timers may be throttled; purge again before a page becomes active.
    document.addEventListener('visibilitychange', expire);
    window.addEventListener('focus', expire);
    return () => { if (timer !== null) clearTimeout(timer); document.removeEventListener('visibilitychange', expire); window.removeEventListener('focus', expire); };
  }, [data]);
  /** One place, on demand (the server fetches or reuses its readings under a per-visitor rate limit and a daily cap). Returns a message for the person when it did not work, else null. */
  const refreshPin = async (pinId: string): Promise<string | null> => {
    try {
      const response = await fetch(`/public/environment/pin/${encodeURIComponent(pinId)}`, { cache: 'no-store' });
      const body = await response.json() as { pin?: EnvPinView; lookup?: { status: string } };
      if (body.pin) setData(value => value ? purge({ ...value, pins: value.pins.map(pin => pin.pinId === pinId ? { ...pin, ...body.pin! } : pin) }) : value);
      switch (body.lookup?.status) {
        case 'fetched': case 'cached': return null;
        case 'rate_limited': return 'Too many refreshes from this visitor. Try again in a minute.';
        case 'daily_cap': return 'The daily limit of live refreshes has been reached. It resets tomorrow.';
        case 'disabled': return 'Live refreshes are switched off on this server.';
        default: return 'Google did not return a reading for this place right now.';
      }
    } catch { return 'The refresh could not be reached. Try again.'; }
  };
  return { data, loading, error, retry: () => setRetry(value => value + 1), refreshPin };
}

export const ENVIRONMENT_COUNTRIES: Record<string, string> = { Singapore: 'SG', Malaysia: 'MY', Brunei: 'BN' };
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function airValues(reading: EnvReading | null): { label: string; value: number }[] {
  const indexes = currentReading(reading)?.data.indexes;
  if (!Array.isArray(indexes)) return [];
  return indexes.flatMap(item => {
    const index = record(item);
    return index && typeof index.aqi === 'number' && Number.isFinite(index.aqi) ? [{ label: typeof index.displayName === 'string' ? index.displayName : typeof index.code === 'string' ? index.code.toUpperCase() : 'AQI', value: index.aqi }] : [];
  });
}
export function temperature(reading: EnvReading | null): string | null {
  const value = record(currentReading(reading)?.data.temperature);
  if (typeof value?.degrees !== 'number' || !Number.isFinite(value.degrees)) return null;
  const unit = value.unit === 'CELSIUS' ? '\u00b0C' : value.unit === 'FAHRENHEIT' ? '\u00b0F' : 'degrees (unit not supplied)';
  return `${value.degrees} ${unit}`;
}

/**
 * Temperature ring on a map pin. Computed at display time from the live (unexpired) reading and never stored; once the reading expires it returns null.
 * The 35, 37 and 40 C edges are the daily-maximum levels MetMalaysia uses for its heat alerts, but a ring is ONE reading: it is not a heat alert or a warning.
 * The lower edges (21, 29) are display choices of ours, not an official scale.
 */
export type TemperatureBand = { id: 'cool' | 'comfortable' | 'warm' | 'hot' | 'very-hot'; label: string; color: string };
export function temperatureBand(pin: Pick<EnvPinView, 'weather'>, now = Date.now()): TemperatureBand | null {
  const value = record(currentReading(pin.weather.current, now)?.data.temperature);
  if (typeof value?.degrees !== 'number' || !Number.isFinite(value.degrees) || value.unit !== 'CELSIUS') return null;
  const t = value.degrees;
  if (t < 21) return { id: 'cool', label: 'Cool, below 21 C', color: '#3b82c4' };
  if (t < 29) return { id: 'comfortable', label: 'Comfortable, 21 to below 29 C', color: '#2e9e5b' };
  if (t < 35) return { id: 'warm', label: 'Warm, 29 to below 35 C', color: '#e0b000' };
  if (t < 37) return { id: 'hot', label: 'Hot, 35 to below 37 C', color: '#e8801a' };
  return { id: 'very-hot', label: 'Very hot, 37 C or more', color: '#d32f2f' };
}


/** Only current Google readings create a pin label. The location always remains available. */
export function environmentPinLabel(pin:EnvPinView, now=Date.now()): { text:string; description:string } | null {
  if(pin.readingState==='never' || pin.readingState==='expired')return null;
  const air=airMonitored(pin)?currentReading(pin.air,now):null;
  const weather=currentReading(pin.weather.current,now);
  const indexes=(Array.isArray(air?.data.indexes)?air.data.indexes:[]).map(record).filter((i):i is Record<string,unknown>=>!!i && typeof i.aqi==='number' && Number.isFinite(i.aqi));
  const index=indexes.find(i=>i.code!=='uaqi')??indexes[0];
  const temp=record(weather?.data.temperature);
  const parts:string[]=[];
  if(typeof temp?.degrees==='number' && Number.isFinite(temp.degrees) && (temp.unit==='CELSIUS'||temp.unit==='FAHRENHEIT'))parts.push(`${temp.degrees} ${temp.unit==='CELSIUS'?'\u00b0C':'\u00b0F'}`);
  const indexName=index && (typeof index.displayName==='string'?index.displayName:typeof index.code==='string'?index.code.toUpperCase():'AQI');
  if(index)parts.push(`${indexName} ${index.aqi}`);
  if(!parts.length)return null;
  return {text:parts.join(' \u00b7 '),description:[parts.join(' \u00b7 '),typeof index?.category==='string'?index.category:null,air?.attribution,weather?.attribution].filter(Boolean).join('. ')};
}
