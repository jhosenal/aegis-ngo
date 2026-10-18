# AEG-TSK-009 — API skeleton, demo auth, read routes

| Field | Value |
|---|---|
| Requirements | AEG-REQ-001, 013, AEG-TST-001, 013 |
| Depends on | TSK-001, TSK-005, TSK-007, TSK-008 |
| Owned paths | `src/api/server.ts`, `src/api/auth.ts`, `src/api/errors.ts`, `src/api/main.ts`, `src/api/routes/health.ts`, `session.ts`, `me.ts`, `cards.ts`, `incidents.ts`, `evidence.ts`, `pins.ts`, `tests/integration/api-auth.test.ts` |
| Read | ENG-002 sections 2 and 3, ENG-004 section 8 |
| Gate | `npm run gate -- TSK-009` |

## Spec
```ts
export interface AppDeps { db: Db; clock: Clock; ids: IdGen; config: AegisConfig; hooks?: { afterCommit?: () => void } }
export function createApp(deps: AppDeps): FastifyInstance;   // no listen here
```
- `auth.ts`: `POST /api/session` (only when `authMode === 'demo'`): body `SessionBody`; user must exist; token = 32 random bytes hex from `crypto.randomBytes`; store `sha256(token)` with expiry 8 h from `clock`; response per ENG-002. Auth hook: parse `Authorization: Bearer`, hash, look up, check expiry (`E_AUTH_EXPIRED` vs `E_AUTH_REQUIRED`), attach `Principal` to the request. Public routes: health and session only.
- Error handler maps `AegisError` using `ERROR_STATUS`; zod errors -> 400 `E_VALIDATION` with `details.issues`; Fastify JSON parse errors -> 400 `E_JSON_PARSE`; anything else -> 500 `E_INTERNAL` with a generic message (log the cause, never return it).
- Read routes exactly per ENG-002 table: `/api/health`, `/api/me`, `/api/cards`, `/api/cards/:cardId` (includes `evidence` views computed at read time and `children`), `/api/evidence/:evidenceId`, `/api/incidents` (with `sourceStatus`), pins (GET/PUT/DELETE). Validate `:cardId` and `:evidenceId` with the id regex from `api-schemas.ts` (400 on mismatch).
- Security headers on every response: `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` for `/api/*`.
- `main.ts`: `loadConfig(process.env)`, open DB, migrate, seed if `tenants` is empty, `listen({host, port})`, print the URL and the mode lines `storage=...` `models=...` `providers=...`. Serving `ui/dist` is added in TSK-013.

## Tests (use `app.inject`, a temp in-memory DB seeded by `seedAll`)
Health shape; login for each seeded user; unknown user id -> 401 `E_AUTH_REQUIRED`; token required elsewhere; tampered and expired token (advance `FixedClock` 9 h) -> 401 with the right code; tenant A cannot read tenant B card or evidence or pins (404); body with `tenantId`/`role` -> 400; SQL metacharacter ids -> 400; incident list has 4 items and the two `sourceStatus` rows; card read returns `evidence` flags at T-now exactly as ENG-004 section 2; every error response matches the envelope; no response contains the token hash or stack text; security headers present; pin PUT twice is idempotent.
