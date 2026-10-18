# AEG-TSK-011 — Provider interface, stubs, gateway, circuit breaker

| Field | Value |
|---|---|
| Requirements | AEG-REQ-008, 009, AEG-CON-002, AEG-TST-008, 009 |
| Depends on | TSK-001, TSK-002, TSK-004 |
| Owned paths | `src/providers/stubs.ts`, `src/providers/gateway.ts`, `src/providers/circuit.ts`, `src/providers/pricing.ts`, `tests/integration/gateway.test.ts` |
| Read | ENG-002 section 7, ENG-004 section 5, `src/providers/budget-ledger.ts`, `src/types/domain.ts` (provider types) |
| Gate | `npm run gate -- TSK-011` |

## Spec
```ts
// pricing.ts
export interface PriceSnapshot { id: string; capturedAt: string; inputMicroPerMTok: number; outputMicroPerMTok: number; source: string }
export function reservationMicro(system: string, user: string, maxOutputTokens: number, p: PriceSnapshot): number;   // ceil((utf8Bytes(system+user)*in + maxOut*out)/1_000_000)
export function actualMicro(u: ModelUsage, p: PriceSnapshot): number;                                              // ceil((inTok*in + outTok*out)/1_000_000)
// circuit.ts
export class CircuitBreaker { constructor(threshold: number, cooldownMs: number, clock: () => number); canAttempt(): boolean; recordSuccess(): void; recordFailure(): void; trip(): void; state(): 'closed' | 'open' | 'half-open' }   // half-open allows exactly ONE probe
// stubs.ts
export type StubStep = { type: 'ok'; text: string; usage?: ModelUsage | null; reportedModel?: string } | { type: 'error'; kind: ProviderErrorKind; possiblyCharged?: boolean } | { type: 'delay'; ms: number };
export class StubProvider implements ModelProvider { constructor(id: 'stub-google' | 'stub-reapi', script: StubStep[]); readonly calls: ModelRequest[] }   // consumes one step per call; honours AbortSignal; isStub = true
// gateway.ts
export interface GatewayDeps { db: Db; clock: Clock; ids: IdGen; config: AegisConfig; ledger: BudgetLedger; primary: ModelProvider; backup: ModelProvider | null; binding: (role: RuntimeRole) => RoleBinding; price: PriceSnapshot | null; sleep: (ms: number) => Promise<void>; rng: () => number; monotonicMs: () => number }
export class ModelGateway { constructor(d: GatewayDeps); call(role: RuntimeRole, task: { taskId: string; tenantId?: string; system: string; user: string; responseSchemaId: string; dataClass: DataClass }, validate: (text: string) => boolean): Promise<GatewayOutcome> }
```
Behaviour exactly as the ENG-002 section 7 table. Each attempt: choose provider (skip when circuit is open: record `CIRCUIT_OPEN`, no network, no reservation), compute reservation, `ledger.reserve` (denied -> record `BUDGET_DENIED`), insert `model_calls` row, call provider with an `AbortSignal` that fires at the remaining task deadline, then classify. Success + usage -> `settle(actual)`; success + null usage -> `markLiability`; TIMEOUT/`possiblyCharged` error -> `markLiability`; error where the request certainly did not reach the provider (stub error with `possiblyCharged` false and kind TRANSIENT/AUTH/BAD_REQUEST) -> `release`. Write one `model.attempted` audit event per attempt: into chain `(AEG, task.tenantId)` when `task.tenantId` is given, otherwise into `(AEG, SYSTEM)`. `GatewayOutcome.text` is non-null only when status is OK and `validate(text)` returned true.
Provider mode: `modelsEnabled === false` -> `call` returns DEGRADED with notice `MODELS_DISABLED` immediately, zero attempts.

## Tests
G1 to G13 of ENG-004 section 5 exactly (G13 with two OS processes or two connections using a small helper). Also: abort signal fires at the deadline; `model_calls.is_stub = 1` for stubs; the `model_calls` row never contains prompt text, only `input_hash`.

## Do not
Write a live HTTP provider here. Import any provider outside this module's folder.
