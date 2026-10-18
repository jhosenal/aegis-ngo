# AEG-UXD-001 — Card workspace UX

| Control field | Value |
|---|---|
| Document ID | AEG-UXD-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Desktop

At 1920x1080, use approximately two thirds for results/cards and one third for chat, after navigation and gutters. Divider is resizable; no brittle fixed 1280/640 pixel assumption.
Left: incident overview, resource assessment, evidence and history. Right: chat, explicit attached context, workflow status and suggested registered actions.
Cards within cards are linked records rendered with progressive disclosure. Each shows title, status, time, source/assumptions and available actions. Keep long evidence collapsed and accessible.

## Mobile

Use chat as the main view, with cards opening in a full-screen or near-full-screen sheet. A dock/tray shows pinned cards; overflow scrolls or collapses to a list. Do not compress unlimited panels onto the screen.
Pinning preserves a card in the workspace. Attaching a card explicitly includes an immutable revision in the next chat request. Pinning alone must not silently expose content to a model.
Maintain readable controls and keyboard focus when opening/closing cards; restore focus to the trigger. Avoid color-only status communication.

## Card state and relationships

Draft -> validated result -> reviewed/approved where applicable -> superseded.
Include cardId, revision, parent/child references, evidence references and formulation/workflow version. Graph cycles and excessive nesting are rejected or bounded.
Changing inputs creates a new result revision. Prior result remains accessible with its original evidence.
Show fact / calculation / estimate / proposal / unknown distinctly. Synthetic demo data must be labelled on the card, not only in README.

## Chat behavior

Known commands and explicit controls reach registered code routes first. Ambiguous intent triggers clarification; use a bounded model only when needed.
Models return structured content; application components render it. Never accept arbitrary generated HTML, scripts or direct executable tool calls.
Show “Google unavailable; backup used” when meaningful, without exposing tokens or internal prompts. With both providers unavailable, retain the available code-built result.
A map supports evidence inspection; it does not imply a route is safe. Feed failures, freshness and missing resources remain visible.

## UX acceptance

Test desktop and phone sizes, mouse/keyboard/touch, long translated text, empty state, loading, feed failure, provider failure and denied permission.
Pin/reopen three cards on desktop and overflow the mobile tray. Attach one revision, change another, and prove the request uses exactly the attached revision.
No fixed maximum count derived solely from screen resolution; use layout capacity and an accessible overflow mechanism.


