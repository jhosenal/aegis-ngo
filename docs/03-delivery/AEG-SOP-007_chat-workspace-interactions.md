# AEG-SOP-007 - Conversation workspace interactions

Revision: 0.1 | Status: REVIEW_DRAFT | Date: 2026-10-17 | Owner: SOL

Applies to the shared sidebar/account, Assist header/composer, saved conversations and local exports. Related: AEG-SOW-002, AEG-SOP-004, AEG-SOP-006, C0022. Helper reasoning/tools/provider rules remain owned by SOP-006.

## Composition and identity

Use the registered chat workspace recipe and shared CSS tokens. Account sits below Search chats and > Recent in column 1. Conversation actions sit in column 3. Context panels are disclosures, not new pages or map commands. Account information comes from the authenticated session; an absent email is explicitly unavailable, not guessed. Sign out of this tab clears the client token, visible history, search and cached messages; this label does not imply server session revocation.

## Conversation data

Use authenticated C0022 endpoints, never demo persistence or localStorage. List/search are paged independently of message pages. Search requires two characters and displays the server complete flag; more result pages remain explicit even when the search covered all owned threads. Render titles/excerpts as text. Scope cache and asynchronous results to the account token; clear on account change. Reopening reads stored blocks and exact revision references; old empty blocks fall back to stored text. An interrupted thread is identified, never reported as a successful answer.

New chat creates an owned empty thread without a model call. The helper sends that thread ID; the server titles it from the first message. Rename trims to the contract maximum of80 characters. Delete requires confirmation and only updates the list after server success. Say Deleted from your history; do not promise permanent erasure or delete incident cards/evidence. Errors remain visible with retry.

## Composer and provenance

+ offers existing AEGIS cards by ID and revision. No uploads, microphone or web-search capability is implied. Keep request cancellation, locked input and IME-safe Enter handling. Changing threads cancels an in-flight request; a late completion belongs only to its original account/thread. Reopened map/place blocks render through existing components; reopening itself never dispatches a map action.

Used in this chat separates attachments recorded with sent messages, reply card references/source credits, and cards staged for the next request. Do not call staged cards sources already used. Display recorded credits only; never invent web searches, uploaded files or source use. Store no Google air/weather readings in this UI cache, browser persistence, exports or automatic chat content; those environmental readings remain isolated to existing in-memory monitoring components.

## Sharing and controls

Share is local Copy conversation and Download Markdown only. It never creates a URL or publishes. Warn that more message pages mean the export covers loaded messages only. User reviews content before exporting. Public links require a separate backend access/expiry/revoke/audit contract.

Escape dismisses popovers and returns focus. Rename/delete actions and + are keyboard reachable. Expanding the chat changes its overlay only; map/reader nodes stay mounted. No ordinary chat menu, account or history action moves the map or restarts the presenter. User-requested map actions in new helper replies retain existing behaviour.

## Verification and boundaries

Desktop Chrome is the target for this patch. Build without the Maps key for browser checks, then restore a normal keyed UI build. Check real endpoint CRUD/search/paging, text-only and block-based history, cancellation, sign-out isolation, provenance, local download, admin colour contrast and unchanged map/reader identity. No paid model calls are needed for UI verification. SNET owns news approval, pin/tag, sample-data, Street View and provider/backend code; report a fault there instead of patching it in this workstream. Local verification is not a hosted release.
