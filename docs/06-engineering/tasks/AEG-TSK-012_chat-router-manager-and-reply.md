# AEG-TSK-012 — Chat: local router, manager role, replies

| Field | Value |
|---|---|
| Requirements | AEG-REQ-003, 004, 006, 008, AEG-TST-003, 004, 006, 013 |
| Depends on | TSK-008, TSK-010, TSK-011 |
| Owned paths | `src/chat/router.ts`, `src/chat/chatService.ts`, `src/roles/manager.ts`, `src/roles/validate.ts`, `src/api/routes/chat.ts`, `tests/unit/router.test.ts`, `tests/integration/chat.test.ts` |
| Read | ENG-002 section 6, ENG-004 section 6, `fixtures/injection-text.json` |
| Gate | `npm run gate -- TSK-012` |

## Spec
```ts
// router.ts (pure)
export type LocalMatch = { routeId: string; args: Record<string, unknown> } | { routeId: null; reason: 'ambiguous' };
export function parseLocalCommand(text: string): LocalMatch;      // grammar in ENG-002 section 6; numbers must be integers 0..1e9 else ambiguous
// roles/validate.ts
export const ManagerProposal: z.ZodType<{ routeId: string | null; args: Record<string, unknown>; clarification: string | null }>;   // strict
export function validateProposal(raw: string, principal: Principal): { ok: true; routeId: string; args: Record<string, unknown> } | { ok: false; code: string }   // JSON.parse + zod + getRoute + modelProposable + role allowed; unknown route -> E_ROUTE_DENIED
export function explainTextIsSafe(modelText: string, cardRendered: string): boolean   // false if it contains '<' or '>' or any digit sequence not present in cardRendered
// chat/chatService.ts
export function handleChat(deps: ChatDeps, principal: Principal, body: ChatBodyT): Promise<ChatReply>
```
Flow: store the user message; `resolveAttachments` (exact revisions); `parseLocalCommand`; local match -> execute the route (assess uses `runWorkflow`, with the incident revision taken from an attachment of that card if present); no match -> if `config.modelsEnabled` call the gateway with role `manager` and `tenantId` set (data class `tenant_private`; prompt contains ONLY the allowlisted route descriptions and the user text, never card content or other tenants' data), `validate = text => validateProposal(text).ok`; accepted proposals are executed through the same route executors with the route's own argument schema; denied or invalid -> reply `denied` or `clarify`; models disabled -> `clarify` with notice `MODELS_DISABLED`. Every message appends `chat.routed` to the caller's tenant chain (payload: route id, source, outcome code; never the text). `explain <cardId>`: always build the explanation from the card in code (fields, status, warnings, assumptions, evidence flags); when models are enabled AND the card is attached AND the gateway returns text that passes `explainTextIsSafe`, append it as a block labelled `Model-written summary`. Replies contain only `ChatBlock`s.
`POST /api/chat` per ENG-002. Providers used by the app instance come from `AppDeps` (add an optional `gateway` field; the default is a gateway over `StubProvider`s when `providerMode === 'stub'`).

## Tests
C1 to C12 of ENG-004 section 6; parser table tests (case-insensitivity of keywords, case-sensitive ids, `unknown`, extra spaces, decimals rejected, negative rejected); provider call counts asserted on the stub; every reply parses as `ChatReply`; no HTML characters in any text block produced from injection fixtures.
