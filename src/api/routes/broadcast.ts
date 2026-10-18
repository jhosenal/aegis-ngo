import { getVoice } from '../../data/repos/bulletinPipeline.js';
import { getTranslation, getVoiceMl } from '../../data/repos/bulletinTranslation.js';
import { buildCardSvg, cardTexts } from '../../services/broadcast/card.js';
import { buildCues } from '../../services/broadcast/subtitles.js';
import { PLAYER_JS, playerHtml } from '../../services/broadcast/player.js';
import type { FastifyInstance } from 'fastify';
import { getBulletin, getReview, latestApprovedBulletin, latestBulletin, listBulletins } from '../../data/repos/broadcast.js';
import type { Clock } from '../../engine/clock.js';
import { loadSchedule, nextCapture, slotTimes } from '../../services/broadcast/schedule.js';

type Db = import('better-sqlite3').Database;

/**
 * GET /public/broadcast/schedule: the slots, capture times, languages, narrated sources and disclosures (also the source of the legal notice wording).
 * GET /public/broadcast/latest[?lang=en]: the newest stored bulletin. A locked language answers with its state and no bulletin, never a machine translation.
 */
export function registerBroadcastRoutes(app: FastifyInstance, db: Db, clock: Clock): void {
  const schedule = loadSchedule();
  app.get('/public/broadcast/schedule', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const next = nextCapture(schedule, clock.now());
    return {
      version: schedule.version, timezone: schedule.timezone, captureLeadMinutes: schedule.captureLeadMinutes, slots: slotTimes(schedule),
      next: { slotId: next.slot.id, captureAt: next.captureAt, airAt: next.airAt },
      coverage: schedule.coverage, languages: schedule.languages, narratedSources: schedule.narratedSources, neverNarrated: schedule.neverNarrated, disclosure: schedule.disclosure,
    };
  });
  /** The voice of a bulletin (MP3 made by Google Cloud Text-to-Speech from the validated script). Public only while the bulletin is approved (or approval is switched off). */
  app.get('/public/broadcast/voice/:bulletinId', async (request, reply) => {
    const { bulletinId } = request.params as { bulletinId: string };
    const lang = String((request.query as { lang?: unknown }).lang ?? 'en');
    const approval = process.env['AEGIS_BROADCAST_APPROVAL'] !== 'off';
    const b = getBulletin(db, bulletinId);
    const voice = b?.slotId === 'drill' ? null : lang === 'en' ? getVoice(db, bulletinId) : getTranslation(db, bulletinId, lang)?.status === 'APPROVED' ? getVoiceMl(db, bulletinId, lang) : null;
    if (!voice || (approval && getReview(db, bulletinId)?.decision !== 'APPROVED')) return reply.code(404).send({ error: 'E_NOT_FOUND', message: 'No voice for this bulletin.' });
    reply.header('Cache-Control', 'public, max-age=300'); reply.header('Content-Type', voice.mime);
    return reply.send(voice.audio);
  });
  /** What a visitor may see of an emergency bulletin: it must be approved (unless approval is off), not an exercise, and for another language the translation must be approved by a person who reads it. */
  const visible = (bulletinId: string, lang: string): { bulletin: NonNullable<ReturnType<typeof getBulletin>>; texts: string[] } | null => {
    const approval = process.env['AEGIS_BROADCAST_APPROVAL'] !== 'off';
    const b = getBulletin(db, bulletinId);
    const tr = lang === 'en' ? null : getTranslation(db, bulletinId, lang);
    if (!b || b.slotId === 'drill' || !b.incident || (approval && getReview(db, bulletinId)?.decision !== 'APPROVED') || (lang !== 'en' && tr?.status !== 'APPROVED')) return null;
    return { bulletin: b, texts: tr ? tr.texts : b.segments.map((s) => s.text) };
  };
  /** The warning card (SVG) of an approved bulletin in English, or in another language once a person who reads it approved that translation. Never a drill. */
  app.get('/public/broadcast/card/:bulletinId', async (request, reply) => {
    const { bulletinId } = request.params as { bulletinId: string };
    const lang = String((request.query as { lang?: unknown }).lang ?? 'en');
    const v = visible(bulletinId, lang);
    if (!v) return reply.code(404).send({ error: 'E_NOT_FOUND', message: 'No card for this bulletin.' });
    reply.header('Cache-Control', 'public, max-age=300'); reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    return reply.send(buildCardSvg({ bulletin: v.bulletin, language: lang, texts: v.texts }));
  });
  /** The subtitles as cues (fractions of the speech, see subtitles.ts) for the player. */
  app.get('/public/broadcast/cues/:bulletinId', async (request, reply) => {
    const { bulletinId } = request.params as { bulletinId: string };
    const lang = String((request.query as { lang?: unknown }).lang ?? 'en');
    const v = visible(bulletinId, lang);
    if (!v) return reply.code(404).send({ error: 'E_NOT_FOUND', message: 'No subtitles for this bulletin.' });
    reply.header('Cache-Control', 'public, max-age=300');
    return { language: lang, cues: buildCues(v.texts, v.bulletin.segments.map((s) => s.id)) };
  });
  /** The page that shows the card, reads it aloud and shows the subtitles in step: /public/emergency/<bulletinId>?lang=ms. */
  app.get('/public/emergency/:bulletinId', async (request, reply) => {
    const { bulletinId } = request.params as { bulletinId: string };
    const lang = String((request.query as { lang?: unknown }).lang ?? 'en');
    const v = visible(bulletinId, lang);
    if (!v) return reply.code(404).send({ error: 'E_NOT_FOUND', message: 'No emergency information for this bulletin.' });
    const { headline, actions } = cardTexts(v.bulletin, v.texts);
    const notice = v.texts[v.bulletin.segments.findIndex((s) => s.id === 'emergency-notice')] ?? '';
    const languages = ['en', ...['ms', 'zh', 'ta'].filter((l) => getTranslation(db, bulletinId, l)?.status === 'APPROVED')];
    reply.header('Cache-Control', 'public, max-age=60'); reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(playerHtml({ bulletinId, language: lang, languages, headline, actions, notice, guidanceSources: v.bulletin.credits.lines.filter((l) => l.startsWith('Guidance:')).map((l) => l.slice('Guidance: '.length)) }));
  });
  app.get('/public/emergency-player.js', async (_request, reply) => { reply.header('Cache-Control', 'public, max-age=300'); reply.header('Content-Type', 'application/javascript; charset=utf-8'); return reply.send(PLAYER_JS); });
  app.get('/public/broadcast/latest', async (request, reply) => {
    const lang = String((request.query as { lang?: unknown }).lang ?? 'en').toLowerCase();
    const language = schedule.languages.find((l) => l.code === lang);
    reply.header('Cache-Control', 'public, max-age=60');
    if (!language) return reply.code(404).send({ error: 'E_NOT_FOUND', message: 'Unknown language.' });
    if (language.state === 'locked') return { language, bulletin: null, recent: [], note: 'This language is a locked stub: it needs a reviewed translation and a voice check. Machine translation is never published unlabelled.' };
    // Screening room: unless AEGIS_BROADCAST_APPROVAL=off, the public page shows only a bulletin an administrator approved.
    const approval = process.env['AEGIS_BROADCAST_APPROVAL'] !== 'off';
    const bulletin = approval ? latestApprovedBulletin(db, language.code) : latestBulletin(db, language.code);
    return { language, bulletin, approvalRequired: approval, recent: listBulletins(db, language.code), ...(approval && !bulletin ? { note: 'No bulletin has been approved yet. Each bulletin is screened by an administrator before it is shown.' } : {}) };
  });
}
