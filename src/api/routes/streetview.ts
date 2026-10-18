import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../engine/clock.js';

/**
 * Street View and Google place details are charged by Google for every use, so the page asks here first (AEG-STREETVIEW-001, AEG-PLACES-001).
 * One shared daily allowance per feature for the whole site; nothing about the viewer or the place is stored, only a count for the day.
 * The 360 image and the place details are never stored or copied: the page shows Google's own content on Google's map with its attribution.
 */
export const STREETVIEW_RULES = { dailyCap: 150 } as const;
/** Place details with phone and hours are the "Enterprise" level (USD 35 per 1,000 after the first 1,000 a month): 30 a day stays inside the free 1,000. */
export const PLACES_RULES = { dailyCap: 30 } as const;

function dailyAllowance(app: FastifyInstance, clock: Clock, path: string, cap: number, spent: string): void {
  let day = ''; let used = 0;
  app.post(path, async (_request, reply) => {
    const today = clock.now().slice(0, 10);
    if (today !== day) { day = today; used = 0; }
    if (used >= cap) { reply.code(429); return { allowed: false, remaining: 0, note: spent }; }
    used += 1;
    return { allowed: true, remaining: cap - used, note: null };
  });
}

export function registerStreetViewRoute(app: FastifyInstance, clock: Clock, cap: number = STREETVIEW_RULES.dailyCap): void {
  dailyAllowance(app, clock, '/public/streetview/open', cap, 'The daily limit for 360° street views has been reached. The map and satellite zoom still work. It resets tomorrow.');
}

export function registerPlacesLookupRoute(app: FastifyInstance, clock: Clock, cap: number = PLACES_RULES.dailyCap): void {
  dailyAllowance(app, clock, '/public/places/open', cap, 'The daily limit for Google place details has been reached. The OpenStreetMap details still show. It resets tomorrow.');
}
