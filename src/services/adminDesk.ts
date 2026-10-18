import { existsSync } from 'node:fs';
// Admin Desk read model (AEG-ADMIN-001): one administrator-only view of spend and the cost gate, the live feeds, the Google environment refresh,
// data confidence and the broadcast desk. It only READS: it makes no provider call, never runs a cloud command and never edits the ledger.
// Money comes from the cost engine (AEG-CON-004) exactly as `npm run cost -- status` prints it; unknown stays unknown.
import { loadBudget, status as costStatus, type Status } from '../costs/engine.js';
import { formatUsd } from '../costs/money.js';
import { readLedger } from '../costs/ledger.js';
import { findPrice, loadPriceBook } from '../costs/pricebook.js';
import type { AegisConfig } from '../config/config.js';
import { BudgetLedger } from '../providers/budget-ledger.js';
import { listEvidence, listSourceStatuses } from '../data/repos/evidence.js';
import { toEvidenceViews } from '../sources/evidenceView.js';
import { latestBulletin } from '../data/repos/broadcast.js';
import { loadSchedule, nextCapture, slotTimes } from './broadcast/schedule.js';
import { buildDataConfidence, LIVE_SOURCE_IDS } from './dataConfidence.js';
import type { EnvStore } from './envStore.js';

type Db = import('better-sqlite3').Database;

export type LanguageState = 'active' | 'locked';
const LANGUAGE_NOTES: Record<string, string> = {
  en: 'Script generator active: template text from the fact sheet, checked before it is stored.',
  ms: 'Translated on request (Google Cloud Translation, checked by code). A person who reads Malay must approve it before it gets a voice; not reviewed by a native speaker.',
  zh: 'Translated on request (Google Cloud Translation, checked by code). A person who reads Mandarin must approve it before it gets a voice; not reviewed by a native speaker.',
  ta: 'Translated on request (Google Cloud Translation, checked by code). A person who reads Tamil must approve it before it gets a voice; not reviewed by a native speaker.',
};

const usd = (nano: bigint): string => formatUsd(nano);

export type RenderState = 'NOT_PRICED' | 'PRICED_NOT_GATED' | 'GATED_GO_NOT_RUN' | 'WAITING_FOR_OWNER' | 'STOPPED' | 'RUN_RECORDED';

/** The render state comes only from the price book and the cost ledger; this desk never starts a render. */
export function renderStatus(cost: Status | null, nowIso: string): AdminDesk['broadcast']['render'] {
  if (cost === null) return { state: 'NOT_PRICED', gpuPriced: false, gates: [], test: { runSheet: 'docs/99-inbox/O0004_snet-to-ops_first-news-render-test.md', scriptReady: false, outputReady: false }, lastGate: null, note: 'The cost ledger and price book are not on this server, so the render state cannot be shown here. See the engineer ledger (npm run cost -- status).' };
  const priced = findPrice(loadPriceBook(), 'GCP.RUN.JOB.GPU.L4.NOZR.ASIA-SOUTHEAST1') !== null;
  const estimates = readLedger().filter((e) => e.type === 'ESTIMATE' && e.actionId.startsWith('AEG-BROADCAST-RENDER'));
  // The job decides the render state; the build (action id ending BUILD-nn) is listed but is not "the last gate" of the render itself.
  const jobs = estimates.filter((e) => e.type === 'ESTIMATE' && !/-BUILD-/.test(e.actionId));
  const last = jobs[jobs.length - 1];
  void nowIso;
  const gates = estimates.map((e) => { const o = cost.open.find((x) => x.seq === e.seq); return e.type !== 'ESTIMATE' ? null : { seq: e.seq, actionId: e.actionId, decision: e.decision.decision, estimateUsd: e.estimateNano === null ? 'unknown' : usd(BigInt(e.estimateNano)), approved: o?.approved ?? false, hasActual: o?.hasActual ?? false }; }).filter((g): g is NonNullable<typeof g> => g !== null);
  const test = { runSheet: 'docs/99-inbox/O0004_snet-to-ops_first-news-render-test.md', scriptReady: existsSync('render/out/script.txt'), outputReady: existsSync('render/out/news-test-1/presenter.webm') };
  if (!last || last.type !== 'ESTIMATE') {
    return { state: priced ? 'PRICED_NOT_GATED' : 'NOT_PRICED', gpuPriced: priced, lastGate: null, gates, test, note: priced ? 'The L4, CPU and memory prices for Singapore are in the price book. No render has been gated yet.' : 'No GPU price is in the price book, so a render cannot be gated (unknown is never free).' };
  }
  const open = cost.open.find((o) => o.seq === last.seq);
  const decision = last.decision.decision;
  const approved = open?.approved ?? false;
  const hasActual = open?.hasActual ?? false;
  const state: RenderState = hasActual ? 'RUN_RECORDED' : decision === 'STOP' ? 'STOPPED' : decision === 'ASK_OWNER' && !approved ? 'WAITING_FOR_OWNER' : 'GATED_GO_NOT_RUN';
  return {
    state, gpuPriced: priced, gates, test, lastGate: { seq: last.seq, actionId: last.actionId, decision, estimateUsd: last.estimateNano === null ? 'unknown' : usd(BigInt(last.estimateNano)), approved, hasActual },
    note: 'The gate decision is for the job timeout (worst case), not for an assumed speed. Only the operations agent runs the job (AEG-SOP-002); this desk shows the ledger and cannot start it.',
  };
}

export interface AdminDesk {
  generatedAt: string;
  /** Null on a server that does not hold the engineer's cost ledger (the hosted image): the desk then says so instead of inventing numbers. */
  spend: {
    period: string; budgetUsd: string; committedUsd: string; remainingUsd: string; autoApproveUsd: string; capEnforced: boolean;
    funding: { source: string; balanceUsd: string; committedUsd: string; remainingUsd: string; expires: string | null }[];
    waitingForOwner: { seq: number; actionId: string }[];
    flagged: number[]; unexplained: { count: number; usd: string }; cardExposureUsd: string; creditAssumedUsd: string;
  } | null;
  models: { enabled: boolean; providerMode: string; committedMicro: number; limits: { accountMicro: number; dayMicro: number; taskMicro: number } };
  feeds: {
    liveTimerOn: boolean;
    sources: { sourceId: string; state: string; lastOkAt: string | null; lastAttemptAt: string; detail: string | null }[];
    publicEvidence: number;
    dataConfidence: { score: number | null; band: string | null; provisional: true };
    googleEnvironment: { refreshOn: boolean; scheduledRefreshOn: boolean; lastRunAt: string | null; readingsHeld: number };
  };
  broadcast: {
    scheduleVersion: string; slots: { id: string; airLocal: string; captureLocal: string; airUtc: string; captureUtc: string }[];
    next: { slotId: string; captureAt: string; airAt: string };
    narratedSources: string[]; neverNarrated: string[];
    languages: { code: string; label: string; state: LanguageState; note: string }[];
    render: { state: RenderState; gpuPriced: boolean; gates: { seq: number; actionId: string; decision: string; estimateUsd: string; approved: boolean; hasActual: boolean }[]; test: { runSheet: string; scriptReady: boolean; outputReady: boolean }; lastGate: { seq: number; actionId: string; decision: string; estimateUsd: string; approved: boolean; hasActual: boolean } | null; note: string };
    latestBulletin: { bulletinId: string; slotId: string; captureAt: string; generatedAt: string; factSheetHash: string; segments: number } | null;
  };
  remarks: string[];
}

export function buildAdminDesk(p: { db: Db; config: AegisConfig; envStore: EnvStore; nowIso: string; env: Record<string, string | undefined>; cost?: Status }): AdminDesk {
  let budget: ReturnType<typeof loadBudget> | null = null;
  let cost: Status | null = null;
  try { budget = loadBudget(); cost = p.cost ?? costStatus(); } catch { budget = null; cost = null; }   // the hosted image does not carry records/costs
  const ledger = new BudgetLedger(p.db, {
    accountMicro: p.config.budget.accountMicro, dayMicro: p.config.budget.dayMicro, taskMicro: p.config.budget.taskMicro,
    providerAccountMicro: { google: p.config.budget.googleMicro, reapi: p.config.budget.reapiMicro },
  });
  const publicEvidence = listEvidence(p.db).filter((r) => r.tenantScope === null);
  const statuses = listSourceStatuses(p.db);
  const confidence = buildDataConfidence(toEvidenceViews(publicEvidence, null, p.nowIso), statuses, p.nowIso);
  const schedule = loadSchedule();
  const lastBulletin = latestBulletin(p.db, 'en');
  const waiting = cost ? cost.open.filter((o) => o.decision === 'ASK_OWNER' && !o.approved) : [];
  return {
    generatedAt: p.nowIso,
    spend: cost === null || budget === null ? null : {
      period: cost.period, budgetUsd: usd(cost.budgetNano), committedUsd: usd(cost.committedNano), remainingUsd: usd(cost.remainingNano),
      autoApproveUsd: budget.autoApproveUsd, capEnforced: budget.capEnforced,
      funding: cost.funding.map((f) => ({ source: f.source, balanceUsd: usd(f.balanceNano), committedUsd: usd(f.committedNano), remainingUsd: usd(f.remainingNano), expires: budget.funding?.[f.source]?.expires ?? null })),
      waitingForOwner: waiting.map((o) => ({ seq: o.seq, actionId: o.actionId })),
      flagged: cost.flagged, unexplained: { count: cost.unexplained.count, usd: usd(cost.unexplained.nano) },
      cardExposureUsd: usd(cost.cardExposureNano), creditAssumedUsd: usd(cost.creditAssumedNano),
    },
    models: { enabled: p.config.modelsEnabled, providerMode: p.config.providerMode, committedMicro: ledger.totals().committedMicro, limits: { accountMicro: p.config.budget.accountMicro, dayMicro: p.config.budget.dayMicro, taskMicro: p.config.budget.taskMicro } },
    feeds: {
      liveTimerOn: p.env['AEGIS_LIVE_FEEDS'] === 'true',
      sources: statuses.filter((s) => (LIVE_SOURCE_IDS as readonly string[]).includes(s.sourceId) || s.sourceId.startsWith('SRC.')).map((s) => ({ sourceId: s.sourceId, state: s.state, lastOkAt: s.lastOkAt, lastAttemptAt: s.lastAttemptAt, detail: s.detail })),
      publicEvidence: publicEvidence.length,
      dataConfidence: { score: confidence.score, band: confidence.band, provisional: true },
      googleEnvironment: { refreshOn: p.envStore.status.enabled, scheduledRefreshOn: p.envStore.status.scheduled, lastRunAt: p.envStore.status.lastRunAt, readingsHeld: p.envStore.all(p.nowIso).length },
    },
    broadcast: {
      scheduleVersion: schedule.version, slots: slotTimes(schedule).map(({ id, airLocal, captureLocal, airUtc, captureUtc }) => ({ id, airLocal, captureLocal, airUtc, captureUtc })),
      next: (() => { const n = nextCapture(schedule, p.nowIso); return { slotId: n.slot.id, captureAt: n.captureAt, airAt: n.airAt }; })(),
      narratedSources: schedule.narratedSources.map((x) => x.name), neverNarrated: schedule.neverNarrated.map((x) => x.name),
      languages: schedule.languages.map((l) => ({ code: l.code, label: l.label, state: l.state, note: LANGUAGE_NOTES[l.code] ?? '' })),
      render: renderStatus(cost, p.nowIso),
      latestBulletin: lastBulletin ? { bulletinId: lastBulletin.bulletinId, slotId: lastBulletin.slotId, captureAt: lastBulletin.captureAt, generatedAt: lastBulletin.generatedAt, factSheetHash: lastBulletin.factSheetHash, segments: lastBulletin.segments.length } : null,
    },
    remarks: [
      'Read-only view. It makes no provider call, runs no cloud command and never edits the cost ledger.',
      'Ledger correction, 2026-10-17: entries 42 and 43 (Cloud Run and Gemini API period totals) were recorded by mistake without the estimate they belong to, and were reversed by entries 44 and 45. Both stay in the chain. The real bill is the Google bill card (billing export).',
      ...(budget === null ? ['Spend and cost-gate figures are not available on this server: the cost ledger lives with the engineer and the operations agent, not in the hosted image.'] : budget.capEnforced ? [] : ['No enforced spend cap is recorded in records/costs/budget.json: the engine limits are the only guard.']),
    ],
  };
}
