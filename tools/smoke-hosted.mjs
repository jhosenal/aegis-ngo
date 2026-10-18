#!/usr/bin/env node
// Post-deploy smoke test for a running Aegis instance (local or hosted). Read-mostly: it signs in as the SYNTHETIC demo users,
// reads, and sends one stub-safe chat only when models are disabled. It never prints a token or a key.
//
// Usage:
//   node tools/smoke-hosted.mjs --url https://SERVICE_URL [--id-token "$(gcloud auth print-identity-token)"] [--expect-storage ephemeral-demo|local]
//                                [--allow-live] [--chat]
// Exit code 0 = every check passed, 1 = at least one failed, 2 = bad usage.
//
// Private Cloud Run services consume the Authorization header for the Google identity token, but Aegis also uses
// "Authorization: Bearer <session token>". Cloud Run accepts the identity token in X-Serverless-Authorization instead and passes
// Authorization through to the app, so --id-token is sent in X-Serverless-Authorization.

const HEX64 = /^[0-9a-f]{64}$/i;

export function parseArgs(argv) {
  const out = { url: null, idToken: null, expectStorage: 'ephemeral-demo', allowLive: false, chat: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') out.url = argv[++i];
    else if (arg === '--id-token') out.idToken = argv[++i];
    else if (arg === '--expect-storage') out.expectStorage = argv[++i];
    else if (arg === '--allow-live') out.allowLive = true;
    else if (arg === '--chat') out.chat = true;
    else return { error: `unknown argument ${arg}` };
  }
  if (!out.url || !/^https?:\/\//.test(out.url)) return { error: '--url is required and must start with http:// or https://' };
  if (!['ephemeral-demo', 'local'].includes(out.expectStorage)) return { error: '--expect-storage must be ephemeral-demo or local' };
  out.url = out.url.replace(/\/+$/, '');
  return out;
}

/** Runs every check against `options.url`. Returns { results: [{name, ok, detail}], passed }. */
export async function runSmoke(options, fetchImpl = fetch) {
  const results = [];
  const record = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
  const base = (headers = {}) => ({ ...(options.idToken ? { 'X-Serverless-Authorization': `Bearer ${options.idToken}` } : {}), ...headers });
  const call = async (method, path, { token, body } = {}) => {
    const headers = base({ ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) });
    try {
      const response = await fetchImpl(options.url + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: response.status, json, text, headers: response.headers };
    } catch (error) {
      return { status: 0, json: null, text: '', headers: new Headers(), error: error instanceof Error ? error.message : String(error) };
    }
  };

  // 1. health, and that it advertises the expected safe configuration
  const health = await call('GET', '/api/health');
  record('health returns 200 and status ok', health.status === 200 && health.json?.status === 'ok', `status ${health.status}${health.error ? ' ' + health.error : ''}`);
  if (health.json) {
    record(`storage is ${options.expectStorage}`, health.json.storage === options.expectStorage, `storage=${health.json.storage}`);
    const live = health.json.providerMode === 'live' || health.json.modelsEnabled === true;
    record('providers are in the safe default (stub, models off) unless --allow-live', options.allowLive || !live, `providerMode=${health.json.providerMode} modelsEnabled=${health.json.modelsEnabled}`);
    record('health body leaks no key-like value', !/(AIza|sk-|api[_-]?key|secret|token)/i.test(health.text), '');
  }
  if (health.status !== 200) return finish(results);

  // 2. unauthenticated access is refused
  const anon = await call('GET', '/api/cards');
  record('no session token: /api/cards is refused with 401', anon.status === 401, `status ${anon.status}`);
  const forged = await call('GET', '/api/cards', { token: 'f'.repeat(64) });
  record('forged 64-hex token is refused with 401', forged.status === 401, `status ${forged.status}`);

  // 3. sign in as the synthetic users
  const session = async (userId) => {
    const r = await call('POST', '/api/session', { body: { userId } });
    return r.status === 200 && HEX64.test(r.json?.token ?? '') ? { token: r.json.token, user: r.json.user } : null;
  };
  const coordA = await session('USER-A-COORD');
  const viewA = await session('USER-A-VIEW');
  const coordB = await session('USER-B-COORD');
  record('demo sign-in works for the three synthetic users', coordA && viewA && coordB, '');
  if (!coordA || !viewA || !coordB) return finish(results);
  const unknown = await call('POST', '/api/session', { body: { userId: 'NOT-A-USER' } });
  record('unknown user cannot sign in', unknown.status === 401, `status ${unknown.status}`);

  // 4. reads
  const me = await call('GET', '/api/me', { token: coordA.token });
  record('/api/me returns the signed-in coordinator', me.status === 200, `status ${me.status}`);
  const modes = await call('GET', '/api/modes', { token: coordA.token });
  // The chat model picker offers the Gemini model ids on purpose (the browser sends the id, the server decides); the backup model's name (gpt-) and any claude- name stay hidden.
  record('/api/modes default is auto and hides the backup model name', modes.status === 200 && modes.json?.default === 'auto' && !/gpt-|claude-/i.test(modes.text), `status ${modes.status}`);
  const cardsA = await call('GET', '/api/cards', { token: coordA.token });
  const cardsB = await call('GET', '/api/cards', { token: coordB.token });
  record('/api/cards returns 200 for both tenants', cardsA.status === 200 && cardsB.status === 200, `A ${cardsA.status}, B ${cardsB.status}`);
  const idsOf = (r) => new Set(JSON.stringify(r.json ?? {}).match(/"cardId":"([^"]+)"/g) ?? []);
  const a = idsOf(cardsA);
  const overlap = [...idsOf(cardsB)].filter((x) => a.has(x));
  record('tenant isolation: tenant B sees none of tenant A\'s cards', overlap.length === 0, `overlapping ids: ${overlap.length}`);
  const incidents = await call('GET', '/api/incidents', { token: coordA.token });
  record('/api/incidents returns 200', incidents.status === 200, `status ${incidents.status}`);
  const budget = await call('GET', '/api/budget', { token: coordA.token });
  // Account-wide spend is for platform administrators only (S0038 finding 8): a coordinator is refused. The admin read is covered by the integration tests.
  record('/api/budget is refused to a coordinator (403 E_FORBIDDEN_ROLE)', budget.status === 403 && budget.json?.error?.code === 'E_FORBIDDEN_ROLE', `status ${budget.status}`);

  // 5. roles and the audit chain
  const viewerAudit = await call('GET', '/api/audit/verify', { token: viewA.token });
  record('viewer cannot verify the audit chain (403)', viewerAudit.status === 403, `status ${viewerAudit.status}`);
  const audit = await call('GET', '/api/audit/verify', { token: coordA.token });
  record('coordinator audit verification passes', audit.status === 200 && audit.json?.ok === true, `status ${audit.status} ok=${audit.json?.ok}`);

  // 6. chat (stub only unless asked); the premium modes must be refused for an unregistered user
  const chatAllowed = options.chat || (health.json?.modelsEnabled === false);
  if (chatAllowed) {
    const chat = await call('POST', '/api/chat', { token: coordA.token, body: { text: 'show incidents', mode: 'auto', idempotencyKey: `smoke-${Date.now()}` } });
    record('chat answers without error', chat.status === 200, `status ${chat.status}`);
  } else {
    record('chat skipped (models enabled; pass --chat to spend a tiny live call)', true, 'skipped');
  }
  const pro = await call('POST', '/api/chat', { token: viewA.token, body: { text: 'hello', mode: 'pro' } });
  record('premium mode "pro" is refused for a user who is not registered', pro.status === 403, `status ${pro.status}`);

  // 6b. the public Assist route obeys the release hold: either withheld (503 E_RELEASE_HELD), released for exactly approved content, or an
  // explicit private preview that says it is not released. Anything else (cards served with no release flag) is a failure.
  const assist = await call('GET', '/public/assist/cards');
  if (assist.status === 503) record('Assist route is withheld while the release is held (503 E_RELEASE_HELD)', assist.json?.error === 'E_RELEASE_HELD', 'withheld');
  else if (assist.status === 200) record('Assist route states its release status', typeof assist.json?.released === 'boolean' && (assist.json.released === true || /Under review/.test(assist.json.notReleasedBanner ?? '')), `released=${assist.json?.released}`);
  else if (assist.status === 404) record('Assist route is not enabled (404 or app page)', true, 'not enabled');
  else record('Assist route answers 200, 503 or is absent', false, `status ${assist.status}`);

  // 7. response hygiene
  record('no X-Powered-By header', !health.headers.get('x-powered-by'), '');
  return finish(results);
}

function finish(results) {
  return { results, passed: results.length > 0 && results.every((r) => r.ok) };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('smoke-hosted.mjs')) {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) { console.error(`smoke-hosted: ${options.error}`); process.exit(2); }
  const { results, passed } = await runSmoke(options);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
  console.log(passed ? `\nSMOKE PASSED (${results.length} checks)` : `\nSMOKE FAILED (${results.filter((r) => !r.ok).length} of ${results.length} checks)`);
  process.exit(passed ? 0 : 1);
}
