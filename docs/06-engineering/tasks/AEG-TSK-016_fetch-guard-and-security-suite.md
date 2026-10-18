# AEG-TSK-016 — Fetch guard and security suite (COULD)

| Field | Value |
|---|---|
| Requirements | AEG-REQ-015, 013, AEG-TST-003, 013, 015 |
| Depends on | TSK-012 |
| Owned paths | `src/sources/safeFetch.ts`, `tests/integration/security.test.ts`, `tests/unit/safeFetch.test.ts` |
| Read | ENG-004 section 8 |
| Gate | `npm run gate -- TSK-016` |

## Spec
```ts
export interface FetchPolicy { allowlist: string[]; maxBytes: number; timeoutMs: number; maxRedirects: number }
export interface Resolver { resolve(host: string): Promise<string[]> }   // returns IP strings; injected in tests
export function safeFetch(url: string, policy: FetchPolicy, deps: { resolver: Resolver; fetchImpl: typeof fetch }): Promise<{ status: number; text: string }>
```
Rules: https only; host must be exactly in the allowlist; every resolved IP (initial and on each redirect) must be public (reject loopback, private 10/172.16-31/192.168, link-local 169.254, `::1`, `fc00::/7`, `fe80::/10`, unspecified); at most `maxRedirects`; abort at `timeoutMs`; stop reading beyond `maxBytes` (reject); reject text containing `<!DOCTYPE` with `<!ENTITY`. Nothing in the app calls `safeFetch` yet; it is the guard for the later live feed adapter.
Also add the end-to-end security suite for ENG-004 section 8 (token tampering, strict bodies, cross-tenant on every route including pin, attach, chat and audit, SQL metacharacters, injection fixtures through chat and through feed text stored in a card title: UI-facing responses must contain the text only as data).

## Tests
Every row of ENG-004 section 8 with injected resolvers and fake `fetchImpl`; no real network.
