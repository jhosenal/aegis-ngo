# AEG-TSK-007 — Cards, links, pins, attachments

| Field | Value |
|---|---|
| Requirements | AEG-REQ-006, 013, AEG-TST-006 |
| Depends on | TSK-002, TSK-004 |
| Owned paths | `src/data/repos/cards.ts`, `src/data/repos/pins.ts`, `src/services/cardService.ts`, `tests/integration/cards.test.ts` |
| Read | ENG-002 section 4, `src/types/domain.ts` (CardBody, CardRevision, CardLink, MAX_CARD_DEPTH) |
| Gate | `npm run gate -- TSK-007` |

## Spec
```ts
export interface NewCardRevision { tenantId: string; cardId?: string; kind: CardKind; title: string; body: CardBody; evidenceIds: string[]; formulationRef: string | null; workflowRunId: string | null; createdBy: string; state: CardState }
export function createCardRevision(db: Db, p: NewCardRevision, ids: IdGen, nowIso: string): CardRevision;   // new card if cardId absent; else revision = max+1 and previous revision set to 'superseded'; tenant of existing card must match else E_NOT_FOUND
export function getCardRevision(db: Db, tenantId: string, cardId: string, revision?: number): CardRevision | null;   // latest if revision absent; other tenants' cards return null
export function listCards(db: Db, tenantId: string, kind?: CardKind): CardSummary[];
export function addLink(db: Db, tenantId: string, link: CardLink): void;
export function getChildren(db: Db, tenantId: string, cardId: string, revision: number): CardLink[];
export function pinCard(db: Db, principal: Principal, cardId: string, nowIso: string): void;     // idempotent; card must be in own tenant
export function unpinCard(db: Db, principal: Principal, cardId: string): void;
export function listPins(db: Db, principal: Principal): { cardId: string; pinnedAt: string }[];
export function resolveAttachments(db: Db, principal: Principal, refs: { cardId: string; revision: number }[]): CardRevision[];   // exact revisions, max MAX_ATTACHMENTS_PER_MESSAGE, any foreign or missing -> E_NOT_FOUND
```
Rules: body JSON stored with `canonicalize`; reading validates `synthetic === true` implies a non-null `syntheticLabel` (throw `E_INTERNAL` otherwise). `addLink`: both ends must exist and belong to `tenantId`; reject a link that closes a cycle (`E_CARD_CYCLE`: the child can already reach the parent); reject if `longestUp(parent) + 1 + longestDown(child) > MAX_CARD_DEPTH` (`E_CARD_DEPTH`). Revisions are never edited in place except the `state` of a previous revision becoming `superseded`. Pinning never alters card content.

## Tests
Revision numbering and supersede; cross-tenant get/pin/attach all fail as not found; pin idempotent; unpin; attachments return the EXACT revision asked for even when a newer exists; 6 attachments rejected by the service as well; self link rejected; cycle of length 3 rejected; depth 6 allowed and depth 7 rejected; synthetic without label rejected on read; list is tenant scoped.
