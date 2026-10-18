import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { FixedClock } from '../../src/engine/clock.js';
import { registerPlacesLookupRoute, registerStreetViewRoute } from '../../src/api/routes/streetview.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

describe('street view allowance', () => {
  it('allows views up to the daily cap, then says so, and resets the next day', async () => {
    const clock = new FixedClock('2026-10-17T02:00:00Z');
    const app = Fastify(); apps.push(app); registerStreetViewRoute(app, clock, 2);
    const open = async () => app.inject({ method: 'POST', url: '/public/streetview/open' });
    const a = await open(); expect(a.statusCode).toBe(200); expect(a.json()).toMatchObject({ allowed: true, remaining: 1 });
    expect((await open()).json()).toMatchObject({ allowed: true, remaining: 0 });
    const c = await open(); expect(c.statusCode).toBe(429); expect(c.json()).toMatchObject({ allowed: false, remaining: 0 });
    clock.set('2026-10-18T02:00:00Z');
    expect((await open()).json()).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('place details have their own, smaller allowance', async () => {
    const app = Fastify(); apps.push(app); registerPlacesLookupRoute(app, new FixedClock('2026-10-17T02:00:00Z'), 1);
    const open = async () => app.inject({ method: 'POST', url: '/public/places/open' });
    expect((await open()).json()).toMatchObject({ allowed: true, remaining: 0 });
    const over = await open(); expect(over.statusCode).toBe(429); expect(over.json().note).toContain('OpenStreetMap');
  });
});
