import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/config.js';
import { openDb } from '../../src/data/db.js';
import { migrate } from '../../src/data/migrate.js';
import { FixedClock } from '../../src/engine/clock.js';
import { SeqIdGen } from '../../src/engine/ids.js';
import { createApp } from '../../src/api/server.js';

const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const saved = process.env['AEGIS_LOCAL_AUTOLOGIN'];
beforeEach(() => { delete process.env['AEGIS_LOCAL_AUTOLOGIN']; });
afterEach(() => { if (saved === undefined) delete process.env['AEGIS_LOCAL_AUTOLOGIN']; else process.env['AEGIS_LOCAL_AUTOLOGIN'] = saved; });

const health = async (aegisEnv: string): Promise<{ env: string; localAutoLogin: boolean }> => {
  const db = openDb(':memory:'); migrate(db, dir, '2026-10-13T00:00:00Z');
  const app = createApp({ db, clock: new FixedClock('2026-10-17T03:00:00Z'), ids: new SeqIdGen(), config: loadConfig(aegisEnv === 'test' ? { AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:' } : { AEGIS_ENV: aegisEnv }) });
  try { return (await app.inject({ method: 'GET', url: '/api/health' })).json() as { env: string; localAutoLogin: boolean }; } finally { await app.close(); }
};

describe('local auto sign-in is announced only on the owner\'s own computer', () => {
  it('is off unless the local switch is set', async () => {
    expect((await health('local')).localAutoLogin).toBe(false);
  });
  it('is on in local mode with AEGIS_LOCAL_AUTOLOGIN=true', async () => {
    process.env['AEGIS_LOCAL_AUTOLOGIN'] = 'true';
    expect(await health('local')).toMatchObject({ env: 'local', localAutoLogin: true });
  });
  it('is never on in test mode, and any other value of the switch is off', async () => {
    process.env['AEGIS_LOCAL_AUTOLOGIN'] = 'true';
    expect((await health('test')).localAutoLogin).toBe(false);
    process.env['AEGIS_LOCAL_AUTOLOGIN'] = 'yes';
    expect((await health('local')).localAutoLogin).toBe(false);
  });
});
