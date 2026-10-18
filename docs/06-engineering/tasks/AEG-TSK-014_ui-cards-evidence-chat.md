# AEG-TSK-014 — UI cards, evidence, assessment form, chat

| Field | Value |
|---|---|
| Requirements | AEG-REQ-004, 005, 006, 007, AEG-UXD-001 |
| Depends on | TSK-010, TSK-012, TSK-013 |
| Owned paths | `ui/src/components/IncidentList.tsx`, `CardView.tsx`, `EvidencePanel.tsx`, `AssessmentForm.tsx`, `ChatPanel.tsx`, `AttachmentChips.tsx`, `StatusBadge.tsx`, `EpistemicTag.tsx`, `SyntheticBanner.tsx`, `ui/src/state/store.ts` (edit), `ui/src/App.tsx` (edit), `ui/src/styles.css` (edit), `ui/src/render.test-utils.ts` (optional), `tests/unit/ui-render.test.ts` |
| Read | ENG-006 sections 3, 4, 5, 6 |
| Gate | `npm run gate -- TSK-014` |

## Spec
Implement section 3 and 4 of ENG-006 exactly: status badges with text and symbol, epistemic tags, synthetic banner on every synthetic card, `Unknown` for null (never 0), flag chips with plain explanations, conflicting sources side by side, collapsed `<details>` for long content, pin and attach controls, attachment chips with exact revision and `newer r<n> available`, assessment form with `Unknown` checkboxes, chat block switch, provider notice texts, loading/empty/error states with test ids.
A tiny pure helper module `ui/src/format.ts` (create it; owned by this card) holds text-mapping functions (status label, flag explanation, notice text, field display value) so they can be unit tested without a DOM: `tests/unit/ui-render.test.ts` imports only that helper and tests: null -> `Unknown`; 0 -> `0`; every card state has a label with a symbol; every provider notice code has the exact text from ENG-006; unknown flag code -> a safe generic label.

## Gate commands
`npm run typecheck`, `npm run build:ui`, `npm run test:unit`, `npm run test:integration`.

## Do not
Render any data as HTML; use colour as the only carrier of status; show the SYNTHETIC label only in a tooltip.
