# AEG-TSK-021 — reAPI backup canary (PHASE 2, OPTIONAL, BLOCKED)

| Field | Value |
|---|---|
| Status | BLOCKED until the owner supplies reAPI credentials, base URL, written terms confirming the data classes allowed, and a budget |
| Requirements | AEG-REQ-008, AEG-DEC-006 |
| Depends on | TSK-019 |
| Owned paths | `src/providers/reapi.ts`, `tests/integration/reapi-adapter.test.ts` |

Backup provider implementing `ModelProvider`, restricted by `AEGIS_REAPI_ALLOWED_DATA_CLASSES` (default `public` only). Same rules as TSK-019: no guessing of endpoints, parameters or prices; spec issued by the engineer from verified documentation. Gateway tests G2, G4, G5, G10 must still pass unchanged. Status stays `implemented` until a live canary with recorded evidence exists.
