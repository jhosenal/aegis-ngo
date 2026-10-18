import { changeUserFlags } from '../../src/data/repos/apiAuth.js';

/** Legacy operational scenarios explicitly use Pro fixtures; production seed/default signup stays Standard. */
export function grantOperationalFixtures(db: import('better-sqlite3').Database): void {
  for (const userId of ['USER-A-COORD', 'USER-A-VIEW', 'USER-B-COORD']) {
    changeUserFlags(db, { actor: 'test-fixture', userId, flags: { plan: 'pro' }, lock: false, now: '2026-10-18T00:00:00Z' });
  }
}
