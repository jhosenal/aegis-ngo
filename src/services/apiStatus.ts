// API status catalogue for the Admin Desk (owner request 2026-10-18): every outside service AEGIS uses, in groups, with what it is for, whether it is billed, and its state.
// Rule: it makes NO call to any outside service (a status page must not cost money or hit a quota). Every state comes from something the server already knows:
//   - what is switched on or configured (the running configuration, never a key's value);
//   - what our own records prove (the last finished or failed job of that kind, the last poll of each live feed).
// A service that is configured but has no proof yet is "Configured", not "Working". A service with no way for the server to know says so.
import type { Database } from 'better-sqlite3';
import type { AegisConfig } from '../config/config.js';
import type { SourceStatus } from '../types/domain.js';
import { SWITCHABLE } from './apiSwitches.js';

export type ApiState = 'working' | 'configured' | 'off' | 'not-set' | 'problem' | 'unknown';
export type ApiCost = 'billed' | 'free' | 'free allowance';
export interface ApiRow {
  id: string; name: string; purpose: string; cost: ApiCost; state: ApiState; detail: string;
  /** When the service was last called (a success or a failure). null: the server keeps no record of it. */
  lastCalledAt: string | null; lastOkAt: string | null; lastProblemAt: string | null;
  /** The setting that controls it (a key or an environment name). */
  switch: string;
  /** True when an administrator can switch it off and on here (it is set up on this server). */
  switchable: boolean; switchedOff: boolean; switchedBy: string | null; switchedAt: string | null;
}
export interface ApiGroup { id: string; title: string; rows: ApiRow[] }
export interface ApiStatus { asOf: string; summary: { working: number; configured: number; off: number; problem: number; total: number }; groups: ApiGroup[]; remarks: string[] }

export interface ApiStatusDeps {
  db: Database; config: AegisConfig; nowIso: string; sources: SourceStatus[];
  tts?: { voice: string } | null; translator?: { name: string } | null; billing?: unknown | null;
  reviewer?: { model: string; location: string } | null;
  env: { enabled: boolean; scheduled: boolean; lastRunAt: string | null; lastFailures: number } | null;
  onDemand?: { lookupsToday: number; dailyMax: number } | null;
  /** The administrator's on/off switches (the services above are the REAL ones, set up or not; a switch only pauses a service that is set up). */
  switches?: Record<string, { off: boolean; changedBy: string; changedAt: string }>;
}

/** A live feed counts as working while it was polled successfully within this window; older than that it is only configured. */
export const FEED_FRESH_HOURS = 6;

interface JobProof { lastCalledAt: string | null; lastOkAt: string | null; lastProblemAt: string | null }
function jobProof(db: Database, kind: string): JobProof {
  const row = db.prepare("SELECT MAX(CASE WHEN status IN ('DONE', 'FAILED') THEN COALESCE(finished_at, created_at) END) AS called, MAX(CASE WHEN status = 'DONE' THEN COALESCE(finished_at, created_at) END) AS ok, MAX(CASE WHEN status = 'FAILED' THEN COALESCE(finished_at, created_at) END) AS bad FROM job_sheet WHERE kind = ?").get(kind) as { called: string | null; ok: string | null; bad: string | null } | undefined;
  return { lastCalledAt: row?.called ?? null, lastOkAt: row?.ok ?? null, lastProblemAt: row?.bad ?? null };
}

/** Model calls are recorded per provider in the budget reservations: the last attempt, and the last one that settled. */
function providerProof(db: Database, provider: 'google' | 'reapi'): JobProof {
  try {   // the table is created by the model ledger on first use; before that there is simply no record
    const row = db.prepare("SELECT MAX(created_at) AS called, MAX(CASE WHEN state = 'settled' THEN updated_at END) AS ok FROM budget_reservations WHERE provider = ?").get(provider) as { called: string | null; ok: string | null } | undefined;
    return { lastCalledAt: row?.called ?? null, lastOkAt: row?.ok ?? null, lastProblemAt: null };
  } catch { return { lastCalledAt: null, lastOkAt: null, lastProblemAt: null }; }
}

/** A service that is switched on, with the proof our records hold: a later failure than success is a problem, any success is working, none is only configured. */
function fromProof(on: boolean, proof: JobProof, none: ApiState = 'off'): { state: ApiState; lastCalledAt: string | null; lastOkAt: string | null; lastProblemAt: string | null } {
  if (!on) return { state: none, ...proof };
  if (proof.lastProblemAt !== null && (proof.lastOkAt === null || proof.lastProblemAt > proof.lastOkAt)) return { state: 'problem', ...proof };
  return { state: proof.lastOkAt !== null ? 'working' : 'configured', ...proof };
}

const FEED_NAMES: Record<string, { name: string; purpose: string }> = {
  'SRC.USGS.LIVE': { name: 'USGS earthquakes', purpose: 'Earthquake records for the map and the incident cards.' },
  'SRC.GDACS.LIVE': { name: 'GDACS alerts', purpose: 'Floods, cyclones, volcanoes, wildfires and earthquakes rated by the UN and EU alert system.' },
  'SRC.NEA.PSI.LIVE': { name: 'NEA air quality (PSI), Singapore', purpose: 'Singapore PSI readings, used in the bulletins and the haze emergency drafts.' },
  'SRC.METMY.FORECAST.LIVE': { name: 'MetMalaysia forecast', purpose: 'Malaysian weather forecasts for the daily bulletins.' },
  'SRC.METMY.WARNINGS.LIVE': { name: 'MetMalaysia warnings', purpose: 'Malaysian weather warnings for the daily bulletins.' },
  'SRC.OPENAQ.STATIONS': { name: 'OpenAQ air stations', purpose: 'Air quality station readings for the monitored places.' },
  'SRC.OPENMETEO.PINS': { name: 'Open-Meteo weather', purpose: 'Weather history and forecast for the monitored places.' },
};

export function buildApiStatus(d: ApiStatusDeps): ApiStatus {
  const cfg = d.config;
  const modelsOn = cfg.modelsEnabled && cfg.providerMode === 'live';
  const stamp = (iso: string): string => `${iso.replace('T', ' ').slice(0, 16)} UTC`;
  /** Adds the switch fields. A service that is set up and switched off by an administrator reads as Off, with who and when; a service that is not set up has no switch. */
  const finish = (r: Omit<ApiRow, 'switchable' | 'switchedOff' | 'switchedBy' | 'switchedAt'>, configured: boolean): ApiRow => {
    const sw = d.switches?.[r.id];
    const switchable = configured && Object.prototype.hasOwnProperty.call(SWITCHABLE, r.id);
    if (switchable && sw?.off) return { ...r, state: 'off', detail: `Switched off by ${sw.changedBy} at ${stamp(sw.changedAt)}. Turn the switch on to use it again.`, switchable: true, switchedOff: true, switchedBy: sw.changedBy, switchedAt: sw.changedAt };
    return { ...r, switchable, switchedOff: false, switchedBy: null, switchedAt: null };
  };
  const ai: ApiRow[] = [];
  const reviewProof = jobProof(d.db, 'review');
  ai.push(finish({ id: 'vertex-argon', name: 'Gemini 4 Argon on Vertex AI', purpose: 'Script review: better wording for a bulletin part, on request, checked by code.', cost: 'billed', ...fromProof(d.reviewer != null, reviewProof),
    detail: d.reviewer ? `Model ${d.reviewer.model}, location ${d.reviewer.location}.${reviewProof.lastOkAt ? '' : ' No review has been run yet.'}` : 'Not set up: no Vertex project is set on this server.', switch: 'AEGIS_VERTEX_PROJECT' }, d.reviewer != null));
  const translateProof = jobProof(d.db, 'translate');
  ai.push(finish({ id: 'translation', name: 'Google Cloud Translation', purpose: 'First-pass translation of bulletins into Malay, Mandarin and Tamil, before a person approves each language.', cost: 'free allowance', ...fromProof(d.translator != null, translateProof),
    detail: d.translator ? `${translateProof.lastOkAt ? 'Used for translations.' : 'No translation has been run yet.'}` : 'Not set up on this server.', switch: 'AEGIS_TRANSLATE_ENABLED' }, d.translator != null));
  const voiceProof = jobProof(d.db, 'voice');
  ai.push(finish({ id: 'tts', name: 'Google Cloud Text-to-Speech', purpose: 'The voice of approved bulletins and emergency alerts.', cost: 'free allowance', ...fromProof(d.tts != null, voiceProof),
    detail: d.tts ? `Voice ${d.tts.voice}.${voiceProof.lastOkAt ? '' : ' No voice has been made yet.'}` : 'Not set up: the voice step uses the browser voice stand-in.', switch: 'AEGIS_TTS_ENABLED' }, d.tts != null));
  const googleChat = providerProof(d.db, 'google');
  const geminiReady = modelsOn && cfg.google.apiKey !== '';
  ai.push(finish({ id: 'gemini-chat', name: 'Gemini API (chat assistant)', purpose: 'The AEGIS Assist chat: the main model when Google is the primary provider, otherwise the standby that answers if the backup model fails.', cost: 'billed', state: geminiReady ? 'configured' : 'off', ...googleChat,
    detail: `${!geminiReady ? `Off because ${!cfg.modelsEnabled ? 'models are switched off on this server' : cfg.providerMode !== 'live' ? `the provider mode is ${cfg.providerMode}, not live` : 'no Google key is set'}. ` : cfg.primaryProvider === 'google' ? 'Main chat model. ' : `Standby: the chat's primary provider is ${cfg.primaryProvider} (AEGIS_PRIMARY_PROVIDER), so Gemini answers only if that model fails. `}Google key ${cfg.google.apiKey !== '' ? 'set' : 'not set'}; models ${cfg.modelsEnabled ? 'on' : 'off'}; provider mode ${cfg.providerMode}. Locked on: set with the provider settings, so it cannot be switched off here.`, switch: 'AEGIS_PRIMARY_PROVIDER, AEGIS_GOOGLE_API_KEY' }, cfg.google.apiKey !== ''));
  const reapiConfigured = cfg.reapi.apiKey !== '' && cfg.reapi.baseUrl !== '';
  ai.push(finish({ id: 'reapi', name: 'Backup model (reAPI)', purpose: 'Chat answers when Google is not the primary provider or fails over.', cost: 'billed', state: reapiConfigured ? 'configured' : 'not-set', ...providerProof(d.db, 'reapi'),
    detail: reapiConfigured ? `Model ${cfg.reapi.model || 'not named'}; ${cfg.primaryProvider === 'reapi' ? 'primary' : 'backup'}. Locked on: set with the provider settings, so it cannot be switched off here.` : 'No key or base address is set.', switch: 'AEGIS_REAPI_API_KEY, AEGIS_REAPI_BASE_URL' }, reapiConfigured));
  ai.push(finish({ id: 'billing-export', name: 'Cloud Billing export (BigQuery)', purpose: 'Reads Google\'s real bill for the Governance and costs tab. Read only.', cost: 'free allowance', state: d.billing != null ? 'configured' : 'off', lastCalledAt: null, lastOkAt: null, lastProblemAt: null,
    detail: d.billing != null ? 'Connected; it is read when the Google bill card is opened. The server keeps no time of the last read.' : 'Not set up: no export table is set on this server.', switch: 'AEGIS_BILLING_EXPORT_TABLE' }, d.billing != null));

  const env: ApiRow[] = [];
  const envOn = d.env != null && d.env.enabled;
  env.push(finish({ id: 'google-env', name: 'Google Air Quality and Weather (scheduled refresh)', purpose: 'Air and weather readings for the monitored places, kept in memory for one hour at most; never narrated.', cost: 'billed',
    state: !envOn ? 'off' : d.env!.lastRunAt === null ? 'configured' : d.env!.lastFailures > 0 ? 'problem' : 'working', lastCalledAt: d.env?.lastRunAt ?? null, lastOkAt: d.env?.lastRunAt ?? null, lastProblemAt: null,
    detail: !envOn ? 'Off: no scheduled call is made to the Google air and weather service. Turn it on in Feeds and telemetry.' : `${d.env!.scheduled ? 'Scheduled' : 'Manual'}; last run ${d.env!.lastRunAt ?? 'never'}${d.env!.lastFailures > 0 ? `, ${d.env!.lastFailures} failed lookups` : ''}.`, switch: 'Feeds and telemetry (Refresh data)' }, d.env != null));
  env.push(finish({ id: 'google-on-demand', name: 'Click-to-fetch for one place', purpose: 'Live air and weather for a place when a visitor asks, with daily and per-minute caps.', cost: 'billed', state: d.onDemand ? 'configured' : 'off', lastCalledAt: null, lastOkAt: null, lastProblemAt: null,
    detail: d.onDemand ? `Ready; it calls Google only when someone clicks fetch. ${d.onDemand.lookupsToday} of ${d.onDemand.dailyMax} lookups used today.` : 'Not set up: no on-demand lookup on this server.', switch: 'AEGIS_ENV_ON_DEMAND' }, d.onDemand != null));

  const feeds: ApiRow[] = [];
  for (const s of d.sources.filter((x) => FEED_NAMES[x.sourceId] !== undefined)) {
    const meta = FEED_NAMES[s.sourceId]!;
    const ageH = s.lastOkAt ? (Date.parse(d.nowIso) - Date.parse(s.lastOkAt)) / 3_600_000 : Infinity;
    const state: ApiState = s.state !== 'OK' ? 'problem' : ageH <= FEED_FRESH_HOURS ? 'working' : 'configured';
    feeds.push(finish({ id: s.sourceId, name: meta.name, purpose: meta.purpose, cost: 'free', state, lastCalledAt: s.lastAttemptAt, lastOkAt: s.lastOkAt, lastProblemAt: s.state === 'OK' ? null : s.lastAttemptAt,
      detail: s.state !== 'OK' ? `${s.state}${s.detail ? `: ${s.detail}` : ''}` : state === 'working' ? 'Polled successfully.' : `Last successful poll is more than ${FEED_FRESH_HOURS} hours old.`, switch: 'AEGIS_LIVE_FEEDS (all live feeds together)' }, true));
  }

  const groups: ApiGroup[] = [
    { id: 'ai', title: 'Google AI and cloud', rows: ai },
    { id: 'env', title: 'Google air and weather', rows: env },
    { id: 'feeds', title: 'Live public data feeds', rows: feeds },
  ];
  const rows = groups.flatMap((g) => g.rows);
  const count = (s: ApiState): number => rows.filter((r) => r.state === s).length;
  return {
    asOf: d.nowIso, summary: { working: count('working'), configured: count('configured'), off: count('off') + count('not-set'), problem: count('problem'), total: rows.length }, groups,
    remarks: [
      'This page makes no call to any outside service: a status page must not cost money or use a quota. "Working" means our own records show a recent success; "Configured" means it is set up but there is no proof yet.',
      'The switch pauses a service that is already set up on this server, and turns it back on. It cannot set up a service that has no key or setting. A switched-off service is treated by the whole app as if it were not set up.',
      'A greyed switch with a lock is a service that is always on: it is set by the server (or by the provider settings) and cannot be switched off here.',
      'Google Maps in the browser is shown in the page itself, because only the browser knows whether its key is in the build.',
      'No key or secret is ever shown here, only whether one is set and which setting controls it.',
    ],
  };
}
