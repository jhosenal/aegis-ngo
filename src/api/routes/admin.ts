import type { FastifyInstance } from 'fastify';
import { AegisError } from '../../engine/errors.js';
import { changeUserFlags, listAccounts, listAdminAudit } from '../../data/repos/apiAuth.js';
import { editLog, getBulletin, getReview, insertBulletin, listBulletins, logEdit, logReview, replaceBulletinBody, reviewLog, setReview } from '../../data/repos/broadcast.js';
import { applyScriptEdits, PROTECTED_SEGMENTS } from '../../services/broadcast/edit.js';
import { buildFollowUp, FOLLOWUP_AREAS, type FollowUpArea } from '../../services/broadcast/followup.js';
import { loadPinRegistry } from '../../sources/pinRegistry.js';
import { createJob, failJob, renderOptions, settleJob, type RenderSpeed } from '../../services/jobs.js';
import { mp3Seconds } from '../../services/audioLength.js';
import { listJobs } from '../../data/repos/jobs.js';
import { cleanStyleRequest, estimateReviewTokens, reviewSegment } from '../../services/broadcast/scriptReview.js';
import { applySpendLimitChange } from '../../costs/budgetEdit.js';
import { buildApiStatus } from '../../services/apiStatus.js';
import { listSwitches, setSwitch } from '../../services/apiSwitches.js';
import { listSourceStatuses } from '../../data/repos/evidence.js';
import { addStep, getPlan, getVoice, listSteps, saveVoice, setPlan, type Output } from '../../data/repos/bulletinPipeline.js';
import { buildEmergencyBulletin, emergencyCandidates } from '../../services/broadcast/emergency.js';
import { approveMemory, getMemory, getTranslation, getVoiceMl, listTranslations, logTranslation, putMemory, rejectMemory, reviewTranslation, saveTranslation, saveVoiceMl, translationLog, voiceLanguages } from '../../data/repos/bulletinTranslation.js';
import { TRANSLATION_LANGUAGES, translateBulletin } from '../../services/broadcast/translation.js';
import { buildCardSvg } from '../../services/broadcast/card.js';
import { buildCues } from '../../services/broadcast/subtitles.js';
import { SEATS } from '../../roles/seats.js';
import type { FactIncident } from '../../services/broadcast/factSheet.js';
import { buildTimeline, evaluateKpi } from '../../services/broadcast/kpi.js';
import { loadLanguageCatalog, normalizeLanguages } from '../../services/broadcast/languages.js';
import { buildDraftNow, factsNow } from '../../services/broadcast/generate.js';
import { loadSchedule } from '../../services/broadcast/schedule.js';
import { buildAdminDesk } from '../../services/adminDesk.js';
import { EnvStore } from '../../services/envStore.js';
import { principalFrom } from '../auth.js';
import type { AppDeps } from '../server.js';

/** Account administration for signed-in administrators (is_admin). Lists Google accounts and changes plan or admin flag. */
export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): void {
  const requireAdmin = (request: Parameters<typeof principalFrom>[0]): void => {
    if (principalFrom(request).isAdmin !== true) throw new AegisError('E_FORBIDDEN_ROLE');
  };
  app.get('/api/admin/users', async (request) => {
    requireAdmin(request);
    return { users: listAccounts(deps.db) };
  });
  app.post('/api/admin/users/:userId', async (request) => {
    requireAdmin(request);
    const { userId } = request.params as { userId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const plan = body.plan === 'pro' || body.plan === 'standard' ? body.plan : undefined;
    const isAdmin = typeof body.isAdmin === 'boolean' ? body.isAdmin : undefined;
    if (plan === undefined && isAdmin === undefined) throw new AegisError('E_VALIDATION', 'Send plan (standard or pro) and/or isAdmin (true or false).');
    if (userId === principalFrom(request).userId && isAdmin === false) throw new AegisError('E_VALIDATION', 'You cannot remove your own administrator rights.');
    // An administrator's explicit change locks the account against the owner's bootstrap email lists, so a revocation survives the next sign-in.
    if (!changeUserFlags(deps.db, { actor: principalFrom(request).userId, userId, flags: { ...(plan ? { plan } : {}), ...(isAdmin !== undefined ? { isAdmin } : {}) }, lock: true, now: deps.clock.now() })) throw new AegisError('E_NOT_FOUND');
    return { ok: true };
  });
  app.get('/api/admin/audit', async (request) => {
    requireAdmin(request);
    return { changes: listAdminAudit(deps.db) };
  });
  /** Admin Desk: spend and the cost gate, feeds, data confidence, Google environment and the broadcast desk. Read-only, administrators only. */
  const fallbackStore = new EnvStore();
  app.get('/api/admin/desk', async (request) => {
    requireAdmin(request);
    return buildAdminDesk({ db: deps.db, config: deps.config, envStore: deps.envStore ?? fallbackStore, nowIso: deps.clock.now(), env: process.env });
  });
  /** Screening room: the draft as at now (not stored), the stored bulletins with their decision, and approve or hold. Administrators only. */
  /** An emergency alert (and an exercise) is read a little faster so the alert stays near 15 seconds; daily news is read at normal speed. AEGIS_TTS_EMERGENCY_RATE overrides (0.9 to 1.3). */
  const emergencyRate = Math.min(1.3, Math.max(0.9, Number(process.env['AEGIS_TTS_EMERGENCY_RATE'] ?? 1.15) || 1.15));
  const speechRate = (slotId: string | undefined): number => (slotId === 'emergency' || slotId === 'drill' ? emergencyRate : 1);
  /** Seconds of speech to render: the real voice when it exists, else the script estimate (about 1.25 times longer in Malay, Tamil about 1.4, at the emergency reading speed of 1.15). */
  const renderMaxParallel = Math.max(1, Math.min(3, Number(process.env['AEGIS_RENDER_MAX_PARALLEL'] ?? 3) || 3));
  const speechSecondsOf = (bulletinId: string, language: string): number => {
    const stored = language === 'en' ? getVoice(deps.db, bulletinId)?.audio : getVoiceMl(deps.db, bulletinId, language)?.audio;
    if (stored) return mp3Seconds(stored);
    const b = getBulletin(deps.db, bulletinId); const base = (b?.segments.reduce((n, s) => n + s.durationSec, 0) ?? 30) / 1.15;
    return base * (({ en: 1, ms: 1.25, zh: 1.15, ta: 1.4 } as Record<string, number>)[language] ?? 1.3);
  };
  const schedule = loadSchedule();
  const languageCatalog = loadLanguageCatalog();
  app.get('/api/admin/screening', async (request) => {
    requireAdmin(request);
    const draft = buildDraftNow({ db: deps.db, clock: deps.clock, schedule });
    const now = deps.clock.now();
    const stored = [...listBulletins(deps.db, 'en', 8), ...listBulletins(deps.db, 'en', 40, true).filter((b) => b.slotId === 'drill').slice(0, 5)].sort((a, b) => b.captureAt.localeCompare(a.captureAt)).map((b) => {
      const review = getReview(deps.db, b.bulletinId); const log = reviewLog(deps.db, b.bulletinId); const steps = listSteps(deps.db, b.bulletinId);
      const plan = getPlan(deps.db, b.bulletinId, b.slotId);
      const timeline = buildTimeline(b, review, log, steps);
      return { ...b, review, log, bulletin: getBulletin(deps.db, b.bulletinId), plan, steps, timeline, kpi: evaluateKpi(plan.scenario, plan.output, timeline, now), translations: listTranslations(deps.db, b.bulletinId), translationLog: translationLog(deps.db, b.bulletinId), editLog: editLog(deps.db, b.bulletinId), protectedSegments: PROTECTED_SEGMENTS, voiceLanguages: voiceLanguages(deps.db, b.bulletinId) };
    });
    return { now, languageCatalog, voiceMode: deps.tts ? 'google-tts' : 'browser-stub', approvalRequired: process.env['AEGIS_BROADCAST_APPROVAL'] !== 'off', draft, stored };
  });
  /** One bulletin (or the unsaved "DRAFT" as at now) for the preview on the landing page. Administrators only. */
  app.get('/api/admin/screening/bulletin/:bulletinId', async (request, reply) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    reply.header('Cache-Control', 'no-store');
    if (bulletinId === 'DRAFT') return { preview: true, bulletin: buildDraftNow({ db: deps.db, clock: deps.clock, schedule }).bulletin, review: null };
    const bulletin = getBulletin(deps.db, bulletinId);
    if (!bulletin) throw new AegisError('E_NOT_FOUND');
    return { preview: true, bulletin, review: getReview(deps.db, bulletinId) };
  });
  /** Emergency bulletin (AEG-NEWS-007): the current incidents an administrator may make one from, most severe first. */
  app.get('/api/admin/screening/emergency/candidates', async (request, reply) => {
    requireAdmin(request);
    reply.header('Cache-Control', 'no-store');
    const facts = factsNow({ db: deps.db, clock: deps.clock, schedule });
    return { now: deps.clock.now(), candidates: emergencyCandidates(facts, schedule).map((i) => ({ evidenceId: i.evidenceId, title: i.title, hazardType: i.hazardType, alertLevel: i.alertLevel, eventTime: i.eventTime, sourceId: i.sourceId })) };
  });
  /** Make an emergency bulletin from one incident: written by code, checked by the daily validator, stored UNREVIEWED. It still needs an administrator's approval; nothing is published by this call. */
  app.post('/api/admin/screening/emergency', async (request) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const output: Output = body.output === 'voice_presenter' ? 'voice_presenter' : 'voice';
    if (typeof body.followUpOf === 'string') {
      // The one-minute follow-up to an alert, for one area (Johor first): code writes it from the same incident and the current facts; it needs its own approval.
      const parent = getBulletin(deps.db, body.followUpOf);
      if (!parent || !parent.incident || (parent.slotId !== 'emergency' && parent.slotId !== 'drill')) throw new AegisError('E_NOT_FOUND', 'The alert to follow up was not found.');
      const area = String(body.area ?? 'Johor') as FollowUpArea;
      if (!FOLLOWUP_AREAS.includes(area)) throw new AegisError('E_VALIDATION', `A follow-up is available for ${FOLLOWUP_AREAS.join(', ')} only.`);
      const head = parent.segments[0]!;
      const incident: FactIncident = { evidenceId: head.evidenceIds[0] ?? `FU-${parent.bulletinId}`, incidentKey: parent.slotId === 'drill' ? 'drill' : 'followup', hazardType: parent.incident.hazardType, alertLevel: parent.incident.alertLevel, title: parent.incident.title, eventTime: parent.incident.eventTime, lat: head.focus?.lat ?? null, lon: head.focus?.lon ?? null, sourceId: head.sourceIds[0] ?? 'SRC.GDACS.LIVE' };
      const at = deps.clock.now(); const by = principalFrom(request).userId;
      const areaPins = loadPinRegistry().pins.filter((x) => x.region.toLowerCase() === area.toLowerCase()).map((x) => x.name.replace(/\s*\(.*\)\s*$/, ''));
      const { bulletin, problems } = buildFollowUp({ schedule, parent, incident, facts: factsNow({ db: deps.db, clock: deps.clock, schedule }), area, areaPins, now: at, bulletinId: deps.ids.next('BULL'), drill: parent.slotId === 'drill' });
      if (problems.length > 0) throw new AegisError('E_VALIDATION', `The follow-up did not pass the check: ${problems.join('; ')}`);
      if (!insertBulletin(deps.db, bulletin)) throw new AegisError('E_VALIDATION', 'A bulletin was already made this instant. Try again.');
      setPlan(deps.db, { bulletinId: bulletin.bulletinId, scenario: 'emergency', output, by, at });
      createJob(deps.db, { kind: 'draft', bulletinId: bulletin.bulletinId, label: `Follow-up for ${area} written by code`, by, at, params: {} });
      return { ok: true, bulletinId: bulletin.bulletinId, followUpOf: parent.bulletinId, area, estimatedSeconds: bulletin.estimatedSeconds, note: 'Follow-up drafted and checked. It is not published until an administrator approves it.' };
    }
    const drillIn = body.drill as Record<string, unknown> | undefined;
    let incident: FactIncident | undefined;
    if (drillIn !== undefined) {
      // A DRILL (an exercise to test the pipeline): the administrator describes the incident, the text says it is an exercise, the bulletin lives in slot "drill" and can never be public.
      const hazard = String(drillIn['hazardType'] ?? '').toUpperCase(); const level = String(drillIn['alertLevel'] ?? '').toUpperCase(); const source = String(drillIn['sourceId'] ?? 'SRC.GDACS.LIVE');
      const title = typeof drillIn['title'] === 'string' ? drillIn['title'].trim().slice(0, 200) : '';
      const lat = Number(drillIn['lat']); const lon = Number(drillIn['lon']);
      if (!['EARTHQUAKE', 'FLOOD', 'STORM', 'VOLCANO', 'WILDFIRE'].includes(hazard) || !['RED', 'ORANGE', 'GREEN'].includes(level) || title.length < 5 || !Number.isFinite(lat) || !Number.isFinite(lon) || !schedule.narratedSources.some((s) => s.sourceId === source))
        throw new AegisError('E_VALIDATION', 'A drill needs hazardType (EARTHQUAKE, FLOOD, STORM, VOLCANO or WILDFIRE), alertLevel, a title, lat, lon and a narratable sourceId.');
      const eventTime = typeof drillIn['eventTime'] === 'string' && Number.isFinite(Date.parse(drillIn['eventTime'])) ? new Date(drillIn['eventTime']).toISOString() : null;
      incident = { evidenceId: `DRILL-${deps.ids.next('EV')}`, incidentKey: 'drill', hazardType: hazard, alertLevel: level, title, eventTime, lat, lon, sourceId: source };
    } else {
      if (typeof body.evidenceId !== 'string') throw new AegisError('E_VALIDATION', 'Send evidenceId of a current incident.');
      incident = emergencyCandidates(factsNow({ db: deps.db, clock: deps.clock, schedule }), schedule).find((i) => i.evidenceId === body.evidenceId);
      if (!incident) throw new AegisError('E_NOT_FOUND', 'That incident is not a current one an emergency bulletin may be made from.');
    }
    const at = deps.clock.now(); const by = principalFrom(request).userId;
    const { bulletin, problems } = buildEmergencyBulletin({ schedule, incident, now: at, bulletinId: deps.ids.next('BULL'), drill: drillIn !== undefined, detail: body.detail === 'full' ? 'full' : 'brief', ...(typeof body.audience === 'string' && /^[A-Z]{3}$/.test(body.audience) ? { audience: body.audience } : {}) });
    if (problems.length > 0) throw new AegisError('E_VALIDATION', `The draft did not pass the check: ${problems.join('; ')}`);
    if (!insertBulletin(deps.db, bulletin)) throw new AegisError('E_VALIDATION', 'An emergency bulletin was already made this instant. Try again.');
    setPlan(deps.db, { bulletinId: bulletin.bulletinId, scenario: 'emergency', output, by, at });
    createJob(deps.db, { kind: 'draft', bulletinId: bulletin.bulletinId, label: 'Emergency draft written by code', by, at, params: {} });
    return { ok: true, bulletinId: bulletin.bulletinId, estimatedSeconds: bulletin.estimatedSeconds, note: 'Draft made and checked. It is not published until an administrator approves it.' };
  });
  /** Translate a bulletin (drafting, so before review): a model translates, code checks numbers and names, a different model translates back for the reviewer. Stored UNREVIEWED; a person approves each language. */
  app.post('/api/admin/screening/:bulletinId/translate', async (request) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    const bulletin = getBulletin(deps.db, bulletinId); if (!bulletin) throw new AegisError('E_NOT_FOUND');
    if (!deps.gateway && !deps.translator) throw new AegisError('E_VALIDATION', 'The models and Google Cloud Translation are both switched off on this server, so nothing can be translated.');
    const asked = (request.body as { languages?: unknown } | null)?.languages;
    const plan = getPlan(deps.db, bulletinId, bulletin.slotId);
    const languages = (Array.isArray(asked) ? asked.map(String) : plan.languages).filter((l) => l !== 'en');
    if (languages.length === 0) throw new AegisError('E_VALIDATION', 'Tick at least one language besides English first.');
    const by = principalFrom(request).userId; const principal = principalFrom(request);
    for (const l of languages) {
      if (!TRANSLATION_LANGUAGES[l]) throw new AegisError('E_VALIDATION', `${l} is a locked stub: no translation prompt or reviewed voice exists for it yet.`);
      if (getTranslation(deps.db, bulletinId, l)?.status === 'APPROVED') throw new AegisError('E_VALIDATION', `The ${l} translation is approved and locked. Reject it first to translate again.`);
    }
    const out = await Promise.all(languages.map(async (l) => {
      const started = Date.now();
      const sourceChars = bulletin.segments.reduce((n, s) => n + s.text.length, 0);
      const job = createJob(deps.db, { kind: 'translate', bulletinId, language: l, label: `Translate to ${l}`, by, at: deps.clock.now(), params: { characters: sourceChars, engine: deps.translator ? 'google' : 'model' } }).job;
      try {
        const r = await translateBulletin({ ...(deps.gateway ? { gateway: deps.gateway } : {}), ...(deps.translator ? { machine: deps.translator } : {}), bulletin, language: l, tenantId: principal.tenantId, taskId: deps.ids.next('TRANS'), models: { translate: SEATS.specialist.reapiModel, back: SEATS.reviewer.reapiModel }, memory: { get: (lang, hash) => getMemory(deps.db, lang, hash) } });
        const at = deps.clock.now();
        putMemory(deps.db, l, r.memory.filter((m) => m.origin === 'fresh').map((m) => ({ hash: m.hash, source: m.source, target: m.target, back: m.back, modelTranslate: r.models.translate, modelBack: r.models.back, at })));
        saveTranslation(deps.db, { bulletinId, language: l, texts: r.texts, back: r.back, problems: r.problems, modelTranslate: r.models.translate, modelBack: r.models.back, memory: r.memory.map((m) => ({ hash: m.hash, origin: m.origin })), by, at });
        logTranslation(deps.db, { bulletinId, language: l, action: 'TRANSLATE', by, at, note: `${r.counts.approved} approved + ${r.counts.machine} remembered + ${r.counts.fresh} new pieces${r.problems.length ? `; ${r.problems.length} problem(s) flagged for the reviewer` : ''}` });
        settleJob(deps.db, job.jobId, { params: { characters: r.memory.filter((m) => m.origin === 'fresh').reduce((n, m) => n + m.source.length, 0), engine: r.models.translate.startsWith('google') ? 'google' : 'model' }, at: deps.clock.now(), by, note: `${r.counts.fresh} new pieces translated, ${r.counts.approved + r.counts.machine} from memory` });
        return { language: l, ok: true, problems: r.problems.length, pieces: r.counts, ms: Date.now() - started, jobId: job.jobId };
      } catch (error) { failJob(deps.db, job.jobId, { at: deps.clock.now(), by, note: error instanceof Error ? error.message.slice(0, 200) : 'The translation failed.' }); return { language: l, ok: false, error: error instanceof Error ? error.message : 'The translation failed.', ms: Date.now() - started }; }
    }));
    return { ok: out.every((o) => o.ok), results: out };
  });
  /** The human gate for a translation: approve (only by someone who confirms they read the language; a translation with flagged problems cannot be approved) or reject. Approved is locked. */
  app.post('/api/admin/screening/:bulletinId/translation/:language', async (request) => {
    requireAdmin(request);
    const { bulletinId, language } = request.params as { bulletinId: string; language: string };
    const body = (request.body ?? {}) as { action?: unknown; readsLanguage?: unknown; note?: unknown };
    const tr = getTranslation(deps.db, bulletinId, language); if (!tr) throw new AegisError('E_NOT_FOUND');
    const by = principalFrom(request).userId; const at = deps.clock.now();
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    if (body.action === 'approve') {
      if (body.readsLanguage !== true) throw new AegisError('E_VALIDATION', 'Approve only if you read this language: confirm it.');
      if (tr.problems.length > 0) throw new AegisError('E_VALIDATION', `This translation has ${tr.problems.length} flagged problem(s) (numbers or names). Translate again, or reject it.`);
      if (tr.status === 'APPROVED') return { ok: true, already: true };
      reviewTranslation(deps.db, { bulletinId, language, status: 'APPROVED', by, at, note }); logTranslation(deps.db, { bulletinId, language, action: 'APPROVE', by, at, note });
      // The pieces become human-approved and are reused as such, except for an exercise: its approval is a test, never a reader's verdict.
      if (getBulletin(deps.db, bulletinId)?.slotId !== 'drill') approveMemory(deps.db, language, tr.memory.map((m) => m.hash), by, at);
      return { ok: true };
    }
    if (body.action === 'reject') {
      if (note === null || note.length < 5) throw new AegisError('E_VALIDATION', 'Write the reason for rejecting (at least 5 characters).');
      reviewTranslation(deps.db, { bulletinId, language, status: 'REJECTED', by, at, note }); logTranslation(deps.db, { bulletinId, language, action: 'REJECT', by, at, note });
      rejectMemory(deps.db, language, tr.memory.map((m) => m.hash));   // its machine pieces are not reused
      return { ok: true };
    }
    throw new AegisError('E_VALIDATION', 'Send action approve or reject.');
  });
  /** The subtitle cues of a bulletin in a language, for the reviewer (any state, drills included). */
  app.get('/api/admin/screening/:bulletinId/cues', async (request) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    const language = String((request.query as { lang?: unknown }).lang ?? 'en');
    const bulletin = getBulletin(deps.db, bulletinId); if (!bulletin) throw new AegisError('E_NOT_FOUND');
    const tr = language === 'en' ? null : getTranslation(deps.db, bulletinId, language);
    if (language !== 'en' && !tr) throw new AegisError('E_NOT_FOUND', 'No translation in that language yet.');
    return { language, cues: buildCues(tr ? tr.texts : bulletin.segments.map((s) => s.text), bulletin.segments.map((s) => s.id)) };
  });
  /** The warning card of a bulletin in a language, for the reviewer (any state, drills included). SVG; render to PNG in a browser. */
  app.get('/api/admin/screening/:bulletinId/card', async (request, reply) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    const language = String((request.query as { lang?: unknown }).lang ?? 'en');
    const bulletin = getBulletin(deps.db, bulletinId); if (!bulletin) throw new AegisError('E_NOT_FOUND');
    const tr = language === 'en' ? null : getTranslation(deps.db, bulletinId, language);
    if (language !== 'en' && !tr) throw new AegisError('E_NOT_FOUND', 'No translation in that language yet.');
    reply.header('Cache-Control', 'no-store'); reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    return reply.send(buildCardSvg({ bulletin, language, texts: tr ? tr.texts : bulletin.segments.map((s) => s.text), drill: bulletin.slotId === 'drill' }));
  });
  /** Choose the output of a bulletin (voice only, or voice then presenter; not after the presenter was requested) and/or its languages (English always; the others are locked stubs that only record the request). */
  app.post('/api/admin/screening/:bulletinId/plan', async (request) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    const b = getBulletin(deps.db, bulletinId); if (!b) throw new AegisError('E_NOT_FOUND');
    const body = (request.body ?? {}) as { output?: unknown; languages?: unknown };
    const plan = getPlan(deps.db, bulletinId, b.slotId);
    let output: Output = plan.output;
    if (body.output !== undefined) {
      if (body.output !== 'voice' && body.output !== 'voice_presenter') throw new AegisError('E_VALIDATION', 'Send output voice or voice_presenter.');
      if (body.output !== plan.output && listSteps(deps.db, bulletinId).some((s) => s.step === 'PRESENTER_REQUESTED')) throw new AegisError('E_VALIDATION', 'The presenter was already requested; the output can no longer change.');
      output = body.output;
    }
    let languages = plan.languages;
    if (body.languages !== undefined) {
      const n = normalizeLanguages(languageCatalog, body.languages);
      if (!n) throw new AegisError('E_VALIDATION', 'Send languages as a list of known language codes.');
      languages = n;
    }
    if (body.output === undefined && body.languages === undefined) throw new AegisError('E_VALIDATION', 'Send output and/or languages.');
    setPlan(deps.db, { bulletinId, scenario: plan.scenario, output, languages, by: principalFrom(request).userId, at: deps.clock.now() });
    return { ok: true };
  });
  /** Prepare the voice: review comes first, so only an approved bulletin. With the Google Cloud Text-to-Speech switched on (AEGIS_TTS_ENABLED) the audio is made and stored; without it this is the browser-voice stub that records the step only. */
  app.post('/api/admin/screening/:bulletinId/voice', async (request) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    const spoken = getBulletin(deps.db, bulletinId);
    if (!spoken) throw new AegisError('E_NOT_FOUND');
    if (getReview(deps.db, bulletinId)?.decision !== 'APPROVED') throw new AegisError('E_VALIDATION', 'Approve the bulletin first: review comes before the voice.');
    const language = typeof (request.body as { language?: unknown } | null)?.language === 'string' ? String((request.body as { language: string }).language) : 'en';
    if (language !== 'en') {
      // Another language: only from a translation a person who reads it has approved, and only with the real voice (the browser stub cannot make a file).
      const lang = TRANSLATION_LANGUAGES[language]; const tr = getTranslation(deps.db, bulletinId, language);
      if (!lang) throw new AegisError('E_VALIDATION', `${language} is a locked stub: it has no reviewed voice yet.`);
      if (tr?.status !== 'APPROVED') throw new AegisError('E_VALIDATION', `The ${language} translation must be approved by a person who reads it before it gets a voice.`);
      if (!lang.speech) throw new AegisError('E_VALIDATION', `Google Cloud Text-to-Speech has no voice for ${lang.name.split(' (')[0]}: the text, card and subtitles work, the voice does not.`);
      if (!deps.tts) throw new AegisError('E_VALIDATION', 'The Google voice is not switched on, so no audio file can be made for this language.');
      const script = tr.texts.join(' '); const t0 = deps.clock.now(); const by0 = principalFrom(request).userId;
      let audio: Buffer;
      const vjob = createJob(deps.db, { kind: 'voice', bulletinId, language, label: `Voice (${language})`, by: by0, at: t0, params: { characters: script.length } }).job;
      try { audio = await deps.tts.synthesize(script, { ...lang.speech, speakingRate: speechRate(getBulletin(deps.db, bulletinId)?.slotId) }); } catch (error) { failJob(deps.db, vjob.jobId, { at: deps.clock.now(), by: by0, note: error instanceof Error ? error.message.slice(0, 200) : 'The voice could not be made.' }); throw new AegisError('E_VALIDATION', `${error instanceof Error ? error.message : 'The voice could not be made.'}`); }
      saveVoiceMl(deps.db, { bulletinId, language, mime: 'audio/mpeg', audio, voice: lang.speech.voice, characters: script.length, by: by0, at: t0 });
      settleJob(deps.db, vjob.jobId, { params: { characters: script.length }, at: deps.clock.now(), by: by0 });
      return { ok: true, mode: 'google-tts', language, characters: script.length };
    }
    const steps = listSteps(deps.db, bulletinId);
    if (steps.some((s) => s.step === 'VOICE_READY')) return { ok: true, already: true };
    const at = deps.clock.now(); const by = principalFrom(request).userId;
    if (deps.tts) {
      const script = spoken.segments.map((s) => s.text).join(' ');
      addStep(deps.db, { bulletinId, step: 'VOICE_REQUESTED', at, by, mode: 'google-tts', note: null });
      let audio: Buffer;
      const vjob = createJob(deps.db, { kind: 'voice', bulletinId, language: 'en', label: 'Voice (en)', by, at, params: { characters: script.length } }).job;
      try { audio = await deps.tts.synthesize(script, { speakingRate: speechRate(spoken.slotId) }); } catch (error) { failJob(deps.db, vjob.jobId, { at: deps.clock.now(), by, note: error instanceof Error ? error.message.slice(0, 200) : 'The voice could not be made.' }); throw new AegisError('E_VALIDATION', `${error instanceof Error ? error.message : 'The voice could not be made.'} The browser voice still works for proof-listening.`); }
      saveVoice(deps.db, { bulletinId, mime: 'audio/mpeg', audio, voice: deps.tts.voice, characters: script.length, by, at: deps.clock.now() });
      settleJob(deps.db, vjob.jobId, { params: { characters: script.length }, at: deps.clock.now(), by });
      addStep(deps.db, { bulletinId, step: 'VOICE_READY', at: deps.clock.now(), by, mode: 'google-tts', note: `Google Cloud Text-to-Speech, voice ${deps.tts.voice}, ${script.length} characters, ${Math.round(audio.length / 1024)} KB of audio.` });
      return { ok: true, mode: 'google-tts', characters: script.length };
    }
    addStep(deps.db, { bulletinId, step: 'VOICE_REQUESTED', at, by, mode: 'browser-stub', note: null });
    addStep(deps.db, { bulletinId, step: 'VOICE_READY', at, by, mode: 'browser-stub', note: 'Stub: the voice is made by the browser from the approved script; no audio file is stored. Google Cloud Text-to-Speech is the planned voice service.' });
    return { ok: true, mode: 'browser-stub' };
  });
  /** The presenter step: action requested (a gated cloud render, NOT started by this call; it records the request) or ready (the video exists: say where). Only for an approved bulletin planned with a presenter. */
  app.post('/api/admin/screening/:bulletinId/presenter', async (request) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    const b = getBulletin(deps.db, bulletinId); if (!b) throw new AegisError('E_NOT_FOUND');
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (getReview(deps.db, bulletinId)?.decision !== 'APPROVED') throw new AegisError('E_VALIDATION', 'Approve the bulletin first: review comes before the presenter.');
    if (getPlan(deps.db, bulletinId, b.slotId).output !== 'voice_presenter') throw new AegisError('E_VALIDATION', 'This bulletin is planned as voice only. Change the output to voice then presenter first.');
    const steps = listSteps(deps.db, bulletinId); const at = deps.clock.now(); const by = principalFrom(request).userId;
    if (!steps.some((s) => s.step === 'VOICE_READY')) throw new AegisError('E_VALIDATION', 'Prepare the voice first: the presenter follows the voice.');
    if (body.action === 'requested') {
      if (steps.some((s) => s.step === 'PRESENTER_REQUESTED')) return { ok: true, already: true };
      const speed = (['normal', 'fast', 'max'] as const).includes(body.speed as RenderSpeed) ? (body.speed as RenderSpeed) : 'normal';
      const lang = typeof body.language === 'string' ? body.language : 'en';
      const option = renderOptions(speechSecondsOf(bulletinId, lang), renderMaxParallel).find((o) => o.speed === speed)!;
      if (!option.available) throw new AegisError('E_VALIDATION', `${speed} needs ${option.parallel} GPUs; the project allows ${renderMaxParallel}.`);
      const made = createJob(deps.db, { kind: 'render', bulletinId, language: lang, label: `Presenter render (${lang}, ${speed})`, by, at, gateOnCredit: true,
        params: { speed, parallel: option.parallel, instanceSeconds: option.instanceSecondsEach * option.parallel, etaSeconds: option.etaSeconds, speechSeconds: Math.round(speechSecondsOf(bulletinId, lang)) },
        note: `Requested at ${speed} speed (${option.parallel} GPU job${option.parallel > 1 ? 's' : ''}), ETA about ${Math.round(option.etaSeconds / 60)} min.` });
      addStep(deps.db, { bulletinId, step: 'PRESENTER_REQUESTED', at, by, mode: 'gated', note: `Job ${made.job.jobId}: ${speed} speed, ETA about ${Math.round(option.etaSeconds / 60)} min, estimate ${made.job.estimateMicro === null ? 'UNKNOWN' : `${(made.job.estimateMicro / 1_000_000).toFixed(2)} USD`}${made.waiting ? ', WAITING for the owner (credit too low)' : ''}. Recorded only: the render is a gated cloud request (AEG-SOP-002 Annex A); this button does not start it.` });
      return { ok: true, jobId: made.job.jobId, speed, etaSeconds: option.etaSeconds, estimateMicro: made.job.estimateMicro, waitingForOwner: made.waiting };
    }
    if (body.action === 'ready') {
      if (!steps.some((s) => s.step === 'PRESENTER_REQUESTED')) throw new AegisError('E_VALIDATION', 'Request the presenter first.');
      if (steps.some((s) => s.step === 'PRESENTER_READY')) return { ok: true, already: true };
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
      if (note.length < 5) throw new AegisError('E_VALIDATION', 'Say where the finished video is (at least 5 characters).');
      addStep(deps.db, { bulletinId, step: 'PRESENTER_READY', at, by, mode: 'manual', note });
      const renderJob = listJobs(deps.db, { bulletinId, kind: 'render' }).find((j) => j.status === 'ESTIMATED' || j.status === 'WAITING_OWNER');
      const actualSeconds = Number(body.instanceSeconds);
      if (renderJob) settleJob(deps.db, renderJob.jobId, { ...(Number.isFinite(actualSeconds) && actualSeconds > 0 ? { params: { ...renderJob.params, instanceSeconds: actualSeconds } } : {}), at, by, note: 'Render finished' });
      return { ok: true };
    }
    throw new AegisError('E_VALIDATION', 'Send action requested or ready.');
  });
  /**
   * Decide on a stored bulletin: action approve, hold or withdraw (a written note is required for withdraw). An approved bulletin is LOCKED: it cannot be approved or held again;
   * it can only be withdrawn with a reason, after which it can be approved again. Every action is logged.
   */
  /** The three presenter render speeds for a bulletin and language, each with its ETA and estimated cost (an estimate until a run is measured). */
  app.get('/api/admin/screening/:bulletinId/render-options', async (request) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    if (!getBulletin(deps.db, bulletinId)) throw new AegisError('E_NOT_FOUND');
    const language = typeof (request.query as { lang?: string }).lang === 'string' ? (request.query as { lang: string }).lang : 'en';
    const speech = speechSecondsOf(bulletinId, language);
    return { bulletinId, language, speechSeconds: Math.round(speech * 10) / 10, maxParallel: renderMaxParallel, options: renderOptions(speech, renderMaxParallel), assumption: 'About 160 s of set-up per GPU job plus 20 s of render per second of speech (measured on one L4), plus 60 s start and 30 s upload. An estimate until the first run is measured.' };
  });
  /**
   * Script review (Pro and Admin): Gemini 4 Argon on Vertex AI proposes a more natural wording for ONE segment. It is only a proposal, checked by the same rules as a hand edit; nothing changes until a person saves it
   * through the script edit. Every call is a job card whose cost is settled from the token counts the API returned.
   */
  /** The API status catalogue: every outside service, in groups, with what it is for, whether it is billed and its state. Makes no call to any outside service. Administrators only. */
  app.get('/api/admin/api-status', async (request) => {
    requireAdmin(request);
    const real = (deps as AppDeps & { unswitched?: AppDeps }).unswitched ?? deps;   // the services as set up, before any administrator switch
    const store = real.envStore;
    return buildApiStatus({
      db: deps.db, config: deps.config, nowIso: deps.clock.now(), sources: listSourceStatuses(deps.db),
      tts: real.tts ?? null, translator: real.translator ?? null, billing: real.billing ?? null,
      reviewer: real.reviewer ? { model: real.reviewer.model, location: real.reviewer.location } : null,
      env: store ? { enabled: store.status.enabled, scheduled: store.status.scheduled, lastRunAt: store.status.lastRunAt, lastFailures: store.status.lastFailures } : null,
      onDemand: real.envOnDemand ? real.envOnDemand.usage() : null,
      switches: Object.fromEntries(Object.entries(listSwitches(deps.db)).map(([id, r]) => [id, { off: r.off, changedBy: r.changedBy, changedAt: r.changedAt }])),
    });
  });
  /** Switch a service that is set up on this server off, or back on. It cannot set up a service that has no key or setting. Administrators only. */
  app.put('/api/admin/api-switch', async (request) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as { id?: unknown; on?: unknown };
    if (typeof body.on !== 'boolean') throw new AegisError('E_VALIDATION', 'Send id and on (true or false).');
    const real = (deps as AppDeps & { unswitched?: AppDeps }).unswitched ?? deps;
    const row = setSwitch(deps.db, real, body.id, body.on, principalFrom(request).userId, deps.clock.now());
    return { ok: true, id: row.apiId, on: !row.off, changedBy: row.changedBy, changedAt: row.changedAt };
  });
  /** The owner's two spend limits (monthly budget and per-action auto-approve), changed with a reason; kept in records/costs/budget.json with a change list. Administrators only; not on the hosted image. */
  app.put('/api/admin/spend-limits', async (request) => {
    requireAdmin(request);
    const next = applySpendLimitChange((request.body ?? {}) as Record<string, unknown>, principalFrom(request).userId, deps.clock.now());
    return { ok: true, monthlyBudgetUsd: next.monthlyBudgetUsd, autoApproveUsd: next.autoApproveUsd };
  });
  app.post('/api/admin/screening/:bulletinId/script-review', async (request) => {
    const p = principalFrom(request);
    if (p.isAdmin !== true && p.plan !== 'pro') throw new AegisError('E_FORBIDDEN_ROLE');
    if (!deps.reviewer) throw new AegisError('E_VALIDATION', 'The script review is not switched on on this server (Vertex AI is not configured).');
    const { bulletinId } = request.params as { bulletinId: string };
    const reviewBody = (request.body ?? {}) as { segmentId?: unknown; text?: unknown; instruction?: unknown; model?: unknown };
    // The picker may send 'auto' (the configured reviewer) or the reviewer's own model id; any other model is not connected to the script review.
    const wantedModel = typeof reviewBody.model === 'string' && reviewBody.model !== '' ? reviewBody.model : 'auto';
    if (wantedModel !== 'auto' && wantedModel !== deps.reviewer.model) throw new AegisError('E_VALIDATION', `The script review runs on ${deps.reviewer.model} only for now; ${wantedModel} is not connected to it.`);
    const segmentId = String(reviewBody.segmentId ?? '');
    const bulletin = getBulletin(deps.db, bulletinId); if (!bulletin) throw new AegisError('E_NOT_FOUND');
    if (getReview(deps.db, bulletinId)?.decision === 'APPROVED') throw new AegisError('E_VALIDATION', 'This bulletin is approved and locked. Withdraw it first to review its script.');
    const seg = bulletin.segments.find((s) => s.id === segmentId); if (!seg) throw new AegisError('E_VALIDATION', 'Send segmentId of a segment of this bulletin.');
    const at = deps.clock.now();
    const job = createJob(deps.db, { kind: 'review', bulletinId, label: `Script review: ${seg.title} (${deps.reviewer.model})`, by: p.userId, at, params: { segmentId, ...estimateReviewTokens(seg.text) } }).job;
    try {
      const r = await reviewSegment({ client: deps.reviewer, bulletin, segmentId, ...(typeof reviewBody.text === 'string' ? { text: reviewBody.text } : {}), instruction: cleanStyleRequest(reviewBody.instruction) });
      const u = r.reply?.usage;
      const settled = u ? settleJob(deps.db, job.jobId, { params: { segmentId, inputTokens: u.promptTokens, outputTokens: u.outputTokens + u.thoughtsTokens }, at: deps.clock.now(), by: p.userId, note: `${r.reply!.model}: ${u.promptTokens} in, ${u.outputTokens} out, ${u.thoughtsTokens} thinking tokens, ${r.reply!.latencyMs} ms` }) : failJob(deps.db, job.jobId, { at: deps.clock.now(), by: p.userId, note: r.problems.join(' ') });
      return { segmentId, original: r.original, proposal: r.proposal, unchanged: r.unchanged, ok: r.ok, problems: r.problems, model: r.reply?.model ?? null, usage: u ?? null, latencyMs: r.reply?.latencyMs ?? null, costUsd: settled?.settledMicro === null || settled?.settledMicro === undefined ? null : (settled.settledMicro / 1_000_000).toFixed(6), jobId: job.jobId };
    } catch (error) {
      failJob(deps.db, job.jobId, { at: deps.clock.now(), by: p.userId, note: error instanceof Error ? error.message.slice(0, 200) : 'The review failed.' });
      throw new AegisError('E_VALIDATION', `${error instanceof Error ? error.message : 'The review failed.'} The script is unchanged.`);
    }
  });
  /** Reword the English script before approval. Refused for an approved bulletin; checked by code (no new number or name); clears translations and voice made from the old words; every change is logged. */
  app.put('/api/admin/screening/:bulletinId/script', async (request) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    const body = (request.body ?? {}) as { edits?: unknown; note?: unknown };
    const bulletin = getBulletin(deps.db, bulletinId); if (!bulletin) throw new AegisError('E_NOT_FOUND');
    if (getReview(deps.db, bulletinId)?.decision === 'APPROVED') throw new AegisError('E_VALIDATION', 'This bulletin is approved and locked. Withdraw it first (with a reason) to edit the script.');
    const edits = (Array.isArray(body.edits) ? body.edits : []).filter((e): e is { id: string; text: string } => typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string' && typeof (e as { text?: unknown }).text === 'string');
    if (edits.length === 0) throw new AegisError('E_VALIDATION', 'Send edits: [{ id, text }].');
    const result = applyScriptEdits(bulletin, edits);
    if (result.problems.length > 0) throw new AegisError('E_VALIDATION', result.problems.join(' '));
    if (result.changes.length === 0) return { ok: true, changed: 0 };
    const by = principalFrom(request).userId; const at = deps.clock.now();
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    replaceBulletinBody(deps.db, result.bulletin);
    for (const c of result.changes) logEdit(deps.db, { bulletinId, segmentId: c.segmentId, before: c.before, after: c.after, by, at, note });
    return { ok: true, changed: result.changes.length, estimatedSeconds: result.bulletin.estimatedSeconds, note: 'Script changed. Translations and voice made from the old words were cleared; make them again.' };
  });
  app.post('/api/admin/screening/:bulletinId', async (request) => {
    requireAdmin(request);
    const { bulletinId } = request.params as { bulletinId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const action = body.action;
    if (action !== 'approve' && action !== 'hold' && action !== 'withdraw') throw new AegisError('E_VALIDATION', 'Send action approve, hold or withdraw.');
    const target = getBulletin(deps.db, bulletinId);
    if (!target) throw new AegisError('E_NOT_FOUND');
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    const current = getReview(deps.db, bulletinId);
    // Same rule as the Admin Desk page: a bulletin nobody decided within an hour of its air time is expired and can no longer be approved (a drill never expires).
    if (action === 'approve' && !current && target.slotId !== 'drill' && Date.parse((deps.db.prepare('SELECT air_at FROM broadcast_bulletins WHERE bulletin_id = ?').get(bulletinId) as { air_at: string }).air_at) + 60 * 60_000 < Date.parse(deps.clock.now()))
      throw new AegisError('E_VALIDATION', 'This bulletin has expired: its air time was more than an hour ago, so it can no longer be approved. Make a new one from the current facts.');
    const by = principalFrom(request).userId; const at = deps.clock.now();
    if (current?.decision === 'APPROVED' && action !== 'withdraw') throw new AegisError('E_VALIDATION', 'This bulletin is approved and locked. Withdraw it first (with a reason) to change it.');
    if (action === 'withdraw') {
      if (current?.decision !== 'APPROVED') throw new AegisError('E_VALIDATION', 'Only an approved bulletin can be withdrawn.');
      if (note === null || note.length < 5) throw new AegisError('E_VALIDATION', 'Write the reason for withdrawing (at least 5 characters).');
      setReview(deps.db, { bulletinId, decision: 'HELD', decidedBy: by, decidedAt: at, note: `Withdrawn: ${note}` });
      logReview(deps.db, { bulletinId, action: 'WITHDRAW', by, at, note });
    } else if (action === 'hold') {
      setReview(deps.db, { bulletinId, decision: 'HELD', decidedBy: by, decidedAt: at, note });
      logReview(deps.db, { bulletinId, action: 'HOLD', by, at, note });
    } else {
      setReview(deps.db, { bulletinId, decision: 'APPROVED', decidedBy: by, decidedAt: at, note });
      logReview(deps.db, { bulletinId, action: 'APPROVE', by, at, note });
    }
    return { ok: true };
  });
}
