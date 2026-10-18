# AEG-TSK-019 — Live Google AI adapter (PHASE 2, BLOCKED)

| Field | Value |
|---|---|
| Status | BLOCKED until the engineer issues `AEG-ENG-007_google-adapter-spec.md` AND the owner supplies the items in ENG-005 section 3 (key, model id, dated price snapshot, hard budgets) |
| Requirements | AEG-REQ-008, 009, AEG-CON-002 |
| Depends on | TSK-011, TSK-012 |
| Owned paths | `src/providers/google.ts`, `tests/integration/google-adapter.test.ts`, `tests/live/google.live.test.ts` (opt-in) |

## Why blocked
Provider request and response formats, model identifiers and prices change. The adapter must be written against documentation verified on the day of the build, not from memory. The programmer never starts this card by itself and never guesses endpoints, parameter names or prices.

## Expected shape once unblocked
Implements `ModelProvider` with built-in `fetch`, the key from config sent in a header (never in a URL, never logged), `AbortSignal` honoured, status-code mapping to `ProviderErrorKind` as given in the engineer's spec, `usage` extracted when present, `reportedModel` captured, structured-output validation by the gateway. Unit tests use a fake `fetch`. One opt-in live test (`npm run test:live`, skipped unless `AEGIS_LIVE_TESTS=true`) makes at most 3 tiny calls under a 50,000 micro-USD limit. Live evidence records the `reportedModel`, usage and measured cost; without it the status word stays `implemented`, never `live-tested`.
