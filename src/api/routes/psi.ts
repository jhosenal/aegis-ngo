import type { FastifyInstance } from 'fastify';
import { latestPsiFetchedBy } from '../../data/repos/airReadings.js';
import type { Clock } from '../../engine/clock.js';
import { bandOf, PSI_ATTRIBUTION, PSI_BANDS, PSI_REGIONS, PSI_SOURCE_ID } from '../../sources/psi.js';

type Db = import('better-sqlite3').Database;

/**
 * GET /public/air/psi: the latest Singapore NEA 24-hour PSI by region with NEA's band names. Licence: Singapore Open Data Licence v1.0 (commercial use allowed,
 * source notice required), so it may be shown at any time and narrated; it is NOT Google data and the one-hour rule does not apply. Null until the first poll succeeded.
 */
export function registerPsiRoute(app: FastifyInstance, db: Db, clock: Clock): void {
  app.get('/public/air/psi', async (_request, reply) => {
    const now = clock.now();
    const stored = latestPsiFetchedBy(db, PSI_SOURCE_ID, now);
    reply.header('Cache-Control', 'public, max-age=60');
    if (!stored) return { asOf: now, reading: null, attribution: PSI_ATTRIBUTION, remarks: ['No PSI reading has been fetched yet on this server.'] };
    const { reading } = stored;
    const regions = PSI_REGIONS.map((region) => ({ region, psi: reading.psi[region], band: bandOf(reading.psi[region]), pm25_24h: reading.pm25?.[region] ?? null }));
    const top = [...regions].sort((a, b) => b.psi - a.psi)[0]!;
    return {
      asOf: now,
      reading: { observedAt: reading.observedAt, updatedAt: reading.updatedAt, fetchedAt: stored.fetchedAt, ageMinutes: Math.round((Date.parse(now) - Date.parse(reading.observedAt)) / 60_000), regions, highest: { region: top.region, psi: top.psi, band: top.band } },
      bands: PSI_BANDS.map((b) => ({ band: b.band, from: b.from, to: b.to })),
      attribution: PSI_ATTRIBUTION,
      remarks: [
        'The 24-hour PSI is NEA\'s regional reading, published hourly. It is a regional value, not a reading at each pin.',
        'Band names and ranges are NEA\'s own. No health advice is attached here: advice is released separately.',
      ],
    };
  });
}
