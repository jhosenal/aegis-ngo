# AEG-SOP-004 — Reusable page and nested-card layout

Date: 2026-10-16. Owner direction: every page follows the landing-page template; cards compose inside cards and reusable formulations stay registered.

## Registry and ownership

The presentation formulation is `AEG.UI.PAGE-SHELL/1.0.0`, registered in `ui/src/formulations/pageTemplates.ts`. It defines page paths, titles, outer card IDs, navigation and Admin section/card composition. Its renderer is `ui/src/shell/WorkspaceShell.tsx`; the landing page uses the same sidebar and recipe identity, retaining its map/presenter specialization. Shared design comes from the landing dashboard tokens/CSS plus scoped `WorkspaceShell.css` rules.

These are UI composition recipes, not hazard, cost or resource calculation formulas. Calculation definitions, units, versions, provenance and UNKNOWN propagation remain in the existing engine registries. A UI restyle does not activate a held formula or change a result. Admin procedures and release/spend gates remain governed by AEG-SOP-003/002.

## Composition

`PageCard` -> shared shell -> registered outer `ModuleCard` -> section/module cards -> data cards, forms or metrics. Preserve stable `data-card-id` and `data-card-kind` values. ModuleCard owns header/action/body/collapse behavior; route code supplies relevant content and state. Existing specialised domain/guidance/history cards keep their source and accessibility contracts inside the outer page card.

The shell owns the 220px dark navigation, logo/home destination, active links, standard account strip, legal footer, responsive drawer and shared AEGIS Assist dock. Emergency Assist and Card workspace keep their own specialised conversation panels and do not acquire a duplicate generic assistant or private attachments. Overview remains labelled synthetic and retains its incident tabs; its old duplicate navigation/header is hidden inside the shared shell.

## Add or duplicate a page

1. Add one typed entry to `pageTemplates` with a unique path, title and stable outer card ID. Reuse an existing layout recipe before creating another one.
2. Create the content component with loading, unavailable, forbidden and empty states in ModuleCards. A zero is only a real zero; missing values stay unknown. Identify live/stored/modelled/preview data and retain source/licence notices.
3. Compose it in `main.tsx` as `<WorkspaceShell page="registeredId"><ContentRoute/></WorkspaceShell>` inside PageCard. The content must not create another site header or left sidebar. Use `assistant={false}` for a workflow that already owns its conversation panel.
4. Put repeated page fragments in reusable components. Put page/section layout definitions in `ui/src/formulations`; business calculations continue to use backend formulation results. Scope route CSS beneath the shared shell or the route component. Do not copy the entire landing stylesheet into a new page.
5. Admin additions preserve existing IDs, approval/hold/withdraw checks, locked language wording, provisional confidence and cost warnings. Use the backend API; no cloud commands, ledger edits or approval mutation on navigation.
6. Verify direct links, reload, Back/Forward between pages, correct active navigation, account continuity, desktop 1680px/phone 390px, keyboard drawer/Escape/focus, nested card IDs, readable forms and no horizontal overflow. Check backend permissions still deny non-administrators. Existing preview/placeholder functions remain explicitly labelled.
7. Run UI typecheck/build and affected browser checks, record evidence, update handover/work log and create a new scoped snapshot. Never reseal an older snapshot to cover new code.

## Local acceptance boundary

This standardises layout and reusable composition. It does not turn Communities/Reports placeholders, unavailable guidance or synthetic Overview data into completed/live workflows. Those require their own API/formulation/SOP work. Session tokens stay in the existing tab-scoped session storage; sign-in changes synchronize the shared header and page in memory. No model/provider call is caused by visiting a page.

## Monitoring place card recipe

AEG.UI.MONITORING-CARD/2.0.0 (owner-approved 2026-10-17 revision) is registered beside the page recipes in pageTemplates.ts. It supersedes the UI-027 compact no-scroll presentation: monitoring and disaster cards now share CardDialog sizing, native modal/focus/Escape behaviour and the portrait desktop/fullscreen phone layout. EnvironmentPopup retains its separate live readings/credits/NEA/history semantics; it is a display composition, not a fabricated persisted incident revision.

Individual monitoring pins show a neutral label only when usable Google temperature and/or a named AQI index is fresh. Each value follows its own deadline, capped at one hour. A missing/expired reading removes that value or the entire label; it does not remove the clickable location. Grouped pins retain icon/count only. Source attribution accompanies the label and full card. No alert colours are inferred from absent data. History/modelled/station information remains accessible from the card even without Google readings. Both live Maps and offline marker views use environmentPinLabel; do not duplicate its expiry/index logic in another renderer.

Reuse CardDialog for a new card detail surface; use the appropriate backend data contract for its body. Keep media data governed by SOW-001/SOP-005 and preserve credits/fallback. Long card content scrolls within the same disaster-style detail view. No extra nested monitoring dialog is needed.
