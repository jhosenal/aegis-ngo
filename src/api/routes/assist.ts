import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DEMO_BANNER_TEXT, DISCLAIMER_TEXT } from '../../assist/contract.js';
import { loadAssistContent } from '../../assist/content.js';
import { loadRemarks } from '../../assist/remarks.js';
import type { AegisConfig } from '../../config/config.js';
import { approvalNotice, currentEndorsements, decideRelease, DEFAULT_ENDORSEMENTS_FILE, DEFAULT_RELEASE_FILE, NOT_RELEASED_BANNER, readEndorsements, readReleaseRecord } from '../../assist/release.js';

/**
 * Public, read-only Assist content (AEG-PLN-003). No login, no cookies, no tenant data, no database access. It sits outside /api/, so the
 * authenticated routes and their auth hook are untouched. A small per-address limiter protects it.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

export function registerAssistRoutes(app: FastifyInstance, config: AegisConfig, now: () => number = Date.now, dir?: string, releaseFile: string = DEFAULT_RELEASE_FILE, endorsementsFile: string = DEFAULT_ENDORSEMENTS_FILE): void {
  if (!config.assist.enabled) return;
  const content = loadAssistContent({ draftMedical: config.assist.draftMedical, allowFixture: config.env !== 'cloud', ...(dir ? { dir } : {}) });
  const remarks = loadRemarks(dir);   // disclosures, outside the content hash (editing one does not cancel an approval)
  const record = readReleaseRecord(releaseFile);
  const decision = decideRelease(record, content.hash);
  // Release hold: in a cloud build content is served only when approved for exactly this content, or in an explicit private preview.
  const withheld = config.env === 'cloud' && !decision.released && !config.assist.preview;
  const hits = new Map<string, { start: number; count: number }>();
  const body = JSON.stringify({
    cards: content.cards,
    disclaimer: DISCLAIMER_TEXT,
    demoBannerText: DEMO_BANNER_TEXT,
    contentHash: content.hash,
    origin: content.origin,
    released: decision.released,
    releaseReason: decision.reason,
    notReleasedBanner: NOT_RELEASED_BANNER,
    remarks,
    approval: approvalNotice(record, decision),
    endorsements: currentEndorsements(readEndorsements(endorsementsFile), content.hash),
  });
  // The cache tag covers the whole body, so a changed remark, approval or endorsement is never served from a stale cache.
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;

  app.get('/public/assist/cards', async (request, reply) => {
    if (withheld) return reply.code(503).header('Cache-Control', 'no-store').send({ error: 'E_RELEASE_HELD', message: decision.reason });
    const t = now();
    const entry = hits.get(request.ip);
    if (!entry || t - entry.start >= WINDOW_MS) hits.set(request.ip, { start: t, count: 1 });
    else {
      entry.count += 1;
      if (entry.count > MAX_PER_WINDOW) {
        return reply.code(429).header('Retry-After', String(Math.ceil((WINDOW_MS - (t - entry.start)) / 1000))).send({ error: 'E_RATE_LIMITED' });
      }
    }
    if (hits.size > 5000) for (const [key, v] of hits) if (t - v.start >= WINDOW_MS) hits.delete(key);
    reply.header('ETag', etag).header('Cache-Control', 'public, max-age=300').header('Content-Type', 'application/json; charset=utf-8');
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.send(body);
  });
}
