# AEG-TSK-001 — Config, clock and ids

| Field | Value |
|---|---|
| Requirements | AEG-CON-002 (budget and mode safety), AEG-REQ-009 |
| Depends on | TSK-000 |
| Owned paths | `src/config/config.ts`, `src/engine/clock.ts`, `src/engine/ids.ts`, `tests/unit/config.test.ts`, `tests/unit/clockIds.test.ts` |
| Read | ENG-002 section 1, `src/types/domain.ts` |
| Gate | `npm run gate -- TSK-001` |

## Goal
Validated configuration with safe defaults, and injectable time and id sources.

## Spec
```ts
// src/engine/clock.ts
export interface Clock { now(): string }                      // ISO-8601 UTC ending in Z
export class SystemClock implements Clock { now(): string }   // new Date().toISOString()
export class FixedClock implements Clock { constructor(iso: string); now(): string; set(iso: string): void; advanceMs(ms: number): void }
// src/engine/ids.ts
export interface IdGen { next(prefix: string): string }
export class RandomIdGen implements IdGen { next(prefix: string): string }   // prefix + '-' + crypto.randomUUID()
export class SeqIdGen implements IdGen { next(prefix: string): string }     // PREFIX-000001, PREFIX-000002 ... per instance, shared counter
// src/config/config.ts
export interface AegisConfig { /* fields exactly as in ENG-002 section 1, camelCase, nested groups: google, reapi, budget, gateway, feed */ }
export class ConfigError extends Error { readonly problems: string[] }
export function loadConfig(env: Record<string, string | undefined>): AegisConfig
```
`loadConfig` parses every variable, applies the defaults and rules in ENG-002 section 1, and collects ALL problems into one `ConfigError`. Booleans accept only `true`/`false`. Integers must be integers. `AEGIS_REAPI_ALLOWED_DATA_CLASSES` is a comma list restricted to `public` and `tenant_private`.

## Tests (names must contain the quoted text)
- "defaults are safe": models disabled, provider mode stub, budgets 0, host 127.0.0.1, storage sqlite-local.
- "live mode needs key model price and budget": `AEGIS_PROVIDER_MODE=live` with any of them missing -> ConfigError listing each missing item.
- "cloud mode": `AEGIS_ENV=cloud` without PORT -> error; with PORT -> host 0.0.0.0 and storage must be `sqlite-ephemeral-demo` (otherwise error).
- "non-loopback host is rejected locally".
- "max primary attempts above max total is rejected".
- "invalid values are all reported at once" (at least 3 problems in one error).
- "FixedClock set and advance", "SeqIdGen deterministic and shared counter", "RandomIdGen unique over 1000".
- "secrets never appear in error messages" (put key `SECRET123` in env with another invalid field; error text must not contain it).

## Do not
Read `process.env` anywhere except a later `main.ts`; `loadConfig` takes the env object as a parameter.

## Done when
Gate PASS.
