import type { FastifyInstance } from 'fastify';
import type { Db } from '../../data/db.js';
import { locateByName } from '../../data/repos/essentialPlaces.js';
import { AegisError } from '../../engine/errors.js';
import type { PinCatalog } from '../../services/pinCatalog.js';
import { principalFrom } from '../auth.js';

/** Read-only lookup against AEGIS's stored monitoring pins and OSM essential places. No geocoding or new pin is created. */
export function registerMapLocateRoute(app: FastifyInstance, db: Db, catalog: PinCatalog): void {
  app.get('/api/map/locate', async (request, reply) => {
    principalFrom(request);
    const raw = (request.query as { name?: unknown }).name;
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{N}\s.'-]+$/u.test(name)) throw new AegisError('E_VALIDATION', 'Enter a place name of 2 to 80 letters.');
    const query = name.toLocaleLowerCase();
    const pins = catalog.pins();
    const exactPin = pins.find(pin => pin.name.toLocaleLowerCase() === query || pin.pinId.toLowerCase() === query);
    const regionPins = exactPin ? [] : pins.filter(pin => pin.region.toLocaleLowerCase() === query);
    const matches = exactPin ? [exactPin] : regionPins;
    reply.header('Cache-Control', 'no-store');
    if (matches.length > 0) {
      const lat = matches.reduce((sum, pin) => sum + pin.lat, 0) / matches.length;
      const lng = matches.reduce((sum, pin) => sum + pin.lng, 0) / matches.length;
      return { found: true, name: exactPin?.name ?? name, lat, lng, source: 'monitoring-pins', approximate: !exactPin || matches.length > 1 };
    }
    const place = locateByName(db, name);
    if (place) return { found: true, name, ...place, source: 'stored-openstreetmap-places', approximate: true };
    return { found: false, name, source: null, approximate: false };
  });
}
