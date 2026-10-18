# AEG-ENG-006 — UI specification

| Field | Value |
|---|---|
| Document ID | AEG-ENG-006 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Claude (engineer) |
| Approval | Authored under owner direction (AEG-ADR-001); not independently audited |
| Classification | Internal |

React + TypeScript + Vite, plain CSS with CSS variables, no UI library, no router (view state in a reducer). Source in `ui/`; build output `ui/dist` served by the API at `/`. Text from data is rendered only as React text nodes (never HTML). The UI imports types from `src/types/domain.ts` with `import type` only.

## 1. Files

`ui/index.html`, `ui/vite.config.ts` (root `ui`, build outDir `dist`, dev proxy `/api` to `http://127.0.0.1:<PORT>`), `ui/tsconfig.json`, `ui/src/main.tsx`, `App.tsx`, `api/client.ts`, `state/store.ts`, `styles.css`, and components: `LoginBar`, `Workspace`, `Divider`, `IncidentList`, `CardView`, `EvidencePanel`, `AssessmentForm`, `ChatPanel`, `AttachmentChips`, `Dock`, `Sheet`, `StatusBadge`, `EpistemicTag`, `SyntheticBanner`, `NoticeBar`.

## 2. Layout

- Desktop (viewport width at least 900 px): CSS grid `grid-template-columns: minmax(480px, var(--left, 2fr)) 6px minmax(320px, var(--right, 1fr))`. Left = card workspace, right = chat. Default ratio 2:1. The divider has `role="separator"`, `aria-orientation="vertical"`, `tabindex="0"`; drag with pointer events; Left/Right arrow keys change the ratio in 2 percent steps within 1.2:1 to 3:1. At 1920 px width the left area is within 1.7 to 2.3 times the right area.
- Mobile (below 900 px): chat is the main full-height view. A top bar button `Cards (n)` opens a `Sheet` (`role="dialog"`, `aria-modal="true"`, focus trapped, Escape closes, focus returns to the opening button). A bottom `Dock` shows pinned cards as horizontally scrollable chips with a `+N` overflow button that opens the pinned list in a sheet. Touch targets at least 44 px.
- Always visible: `LoginBar` (user, tenant, role; demo login selector), a status strip showing storage mode (`Local` or `Ephemeral demo storage`) and model mode (`Models: disabled`, `Models: stub (not live)` or `Models: live`).

## 3. Card presentation

- Header: title, `StatusBadge` (text plus symbol, never colour alone): draft `… Draft`, validated `✓ Validated`, reviewed `✓✓ Reviewed`, superseded `↺ Superseded`, awaiting input `⚠ Awaiting input`.
- `SyntheticBanner` inside every card whose `synthetic` is true, showing `syntheticLabel`.
- Fields in a definition list. Each value has an `EpistemicTag` text label: `FACT`, `CALCULATION`, `ESTIMATE`, `PROPOSAL`, `UNKNOWN` (distinct border styles). Null values show `Unknown` and are never shown as 0.
- Evidence flags returned by the API (`STALE`, `SUPERSEDED`, `CONFLICTING`, `COORD_INVALID`, `SYNTHETIC`) are shown as labelled chips with plain explanations. Conflicting sources are shown side by side, not merged.
- Long content (evidence details, hashes, assumptions) sits in `<details>` sections collapsed by default.
- Card actions: `Pin`/`Unpin` (keeps the card in the workspace; says in its tooltip text "Does not share content with models"), `Attach to chat` (explicit one-message attachment). Attached cards appear as chips above the chat input: `<cardId> r<revision>`; if a newer revision exists the chip adds `newer r<n> available` but still sends the chip's revision. Chips clear after sending or when removed.
- Assessment form: inputs demand, available, reserve (empty = use stored record, `Unknown` checkbox = null), unit, region, run button. Result appears as a card. Validation errors show the API code and message.

## 4. Chat

`ChatPanel` renders `ChatBlock`s through a switch: `text` (plain), `cardRef` (opens the card), `table`, `notice` (role `status`; level icon plus text). Provider notices use these texts: `GOOGLE_UNAVAILABLE_BACKUP_USED` "Primary model unavailable; a backup model answered." `MODELS_UNAVAILABLE` "Models are unavailable. Showing the calculated result only." `MODELS_DISABLED` "Models are turned off. Use a command such as: help." `BUDGET_EXHAUSTED` "Model budget is used up. Showing the calculated result only." `REFUSED` "The model declined this request." Messages list has `aria-live="polite"`.

## 5. States

Every data view has loading, empty and error states with the test ids below. Errors show the API error code and message, never a stack trace.

## 6. Test ids (exact)

`login-select`, `login-button`, `status-storage`, `status-models`, `workspace`, `workspace-left`, `workspace-right`, `divider`, `incident-list`, `incident-item-<cardId>`, `card-view-<cardId>`, `card-status`, `synthetic-banner`, `field-<key>`, `epistemic-<key>`, `evidence-flag-<FLAG>`, `pin-toggle`, `attach-toggle`, `attachment-chip-<cardId>`, `assessment-form`, `input-demand`, `input-available`, `input-reserve`, `unknown-demand`, `unknown-available`, `unknown-reserve`, `run-assessment`, `chat-panel`, `chat-input`, `chat-send`, `chat-message-<n>`, `notice-<code>`, `cards-button`, `sheet`, `sheet-close`, `dock`, `dock-chip-<cardId>`, `dock-overflow`, `error-<area>`, `loading-<area>`, `empty-<area>`.

## 7. Browser test list (TSK-015)

1. 1920x1080: workspace and chat visible together; left/right width ratio between 1.7 and 2.3; arrow keys on the divider change it.
2. Login as tenant A coordinator; incident list shows 4 incidents; flood incident shows CONFLICTING chips; stale incident shows STALE; bad-coordinate incident shows COORD_INVALID and `Unknown` location.
3. Run assessment demand 120 -> `field-shortfallUnits` shows 40 with CALCULATION tag; synthetic banner visible; no model request made while models disabled.
4. Pin three cards; reload; pins persist (server side).
5. Attach incident revision 1 while revision 2 exists; intercept `POST /api/chat`; the body has `attachments[0].revision === 1`.
6. 390x844: chat visible; `Cards (n)` opens sheet; Escape closes and focus returns; pin six cards -> dock shows `+N`.
7. Keyboard: tab order reaches input, send, cards button; focus rings visible.
8. Screenshots saved to `records/screenshots/` (desktop-workspace.png, mobile-chat.png, mobile-sheet.png). Honest limitation text: screenshots are not an accessibility audit.
