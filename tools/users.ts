// Local account administration (S0038): list accounts made by Google sign-in, or grant/revoke admin and Pro in the local database.
//   npm run users -- list
//   npm run users -- admin <email> [off]
//   npm run users -- pro <email> [off]
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/config.js';
import { openDb, projectRoot } from '../src/data/db.js';
import { changeUserFlags, findUserByEmail, listAccounts } from '../src/data/repos/apiAuth.js';

const [command, email, mode] = process.argv.slice(2);
const config = loadConfig(process.env);
const db = openDb(config.dbPath === ':memory:' ? ':memory:' : resolve(projectRoot(), config.dbPath));
try {
  if (command === 'list') {
    for (const a of listAccounts(db)) console.log(`${a.userId}  ${a.email}  ${a.displayName}  plan=${a.plan}  admin=${a.isAdmin}  terms=${a.termsVersion ?? '-'}  created=${a.createdAt ?? '-'}`);
  } else if ((command === 'admin' || command === 'pro') && email) {
    const user = findUserByEmail(db, email);
    if (!user) throw new Error(`No account with email ${email}. The person must sign in with Google and accept the terms first.`);
    const on = mode !== 'off';
    changeUserFlags(db, { actor: 'cli', userId: user.principal.userId, flags: command === 'admin' ? { isAdmin: on } : { plan: on ? 'pro' : 'standard' }, lock: true, now: new Date().toISOString() });
    console.log(`${email}: ${command} ${on ? 'granted' : 'removed'}`);
  } else {
    console.log('Usage: npm run users -- list | admin <email> [off] | pro <email> [off]');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  db.close();
}
