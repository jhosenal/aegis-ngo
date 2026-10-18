# AEG-SOW-002 - Chat navigation and controls

Revision: 0.2 | Status: REVIEW_DRAFT | Date: 2026-10-17 | Owner: SOL frontend, SNET backend

Owner approved implementation after this original plan. C0022 now supplies live localhost conversation endpoints; current UI delivery and verification are tracked as AEG-CHAT-UI-047. The historical proposal below is interpreted through C0022; no fixtures or public share links ship. Existing AEG-SOP-004 reusable page/card composition and AEG-SOP-006 helper behaviour remain applicable. The references guide interaction patterns; retain AEGIS typography, navy/blue palette, icons and three-column shell.

## Intended layout

Column 1: brand and existing page navigation; New chat entry; lower scrollable chat-history area; Search chats; > Recent disclosure; bottom-pinned account control. Search/history remain immediately above the account, and the account stays accessible when the list scrolls. Group recent chats by Today, Yesterday and Earlier with date labels in MYT. Existing legal/pilot footer remains accessible without overlapping account or history.

Column 2: current map/content workspace. Opening a chat or account menu must not reset country selection, camera, cards or reader state. Explicit chat map actions remain allowed.

Column 3: compact header containing AEGIS Assist, current conversation title, Used in this chat, Share, and More. Keep existing resize/collapse capability; add expand to a wider conversation view without duplicating the chat or restarting requests. Header and composer stay fixed while messages scroll.

## A - Search and Recent

- Search own chats by title and message text; debounced input, paginated results, loading/error/empty states. Show title, date and safe excerpt. Do not present loaded-page-only matching as a complete search.
- > Recent expands/collapses independently of search; selected chat has a clear active state. Each row has a keyboard-accessible More menu with Rename and Delete.
- New chat creates a separate conversation; opening a recent chat restores its messages and exact card revision references. Conversation state belongs above the panel mount so page navigation/collapse does not create a new thread accidentally.
- Delete requests a small confirmation naming the chat, then removes it only after server success; errors preserve the row. Deleting the current conversation opens a clean new chat. Never call it permanent erasure if audit/retention rules retain anything.
- Guests see an honest sign-in prompt rather than saved history. No cross-user or cross-tenant cache; sign-out clears the visible state and searches.

## B - Account at the bottom

Single avatar/name control, replacing the existing top-left account and duplicate column-3 login area. Guest variant says Sign in. Popover shows verified name, email when present, organisation/tenant and role. Actions: settings/preferences, usage/credits where an existing endpoint supports it, language preference, help, legal/pilot notice and Sign out. Do not invent subscriptions, upgrades or unsupported language/model availability. Language preference must not imply the English-only helper suddenly speaks other languages. Use the same account component across routes.

## C - Conversation actions and context

- Used in this chat opens a compact provenance panel listing attached card IDs/revisions and actually returned source links, with source attribution. Separate attached context from sources actually used. Do not claim web search or uploads happened without recorded evidence.
- Share opens a preview with Copy conversation and Download text/Markdown first. Mark these as local exports; review personal information and attached restricted records. Copy/export does not create a public link.
- Share link is a second phase only after SNET supplies explicit access rules, expiry/revoke and an audit trail. No automatic publication or credentials in URLs; recheck source permissions on retrieval.
- More: Rename, Export and Delete for the current conversation. Existing collapse control remains accessible.

## D - Composer

Rounded AEGIS composer with + at left, expanding text input, existing supported mode selector, Send at right changing to Cancel while busy. Enter sends; Shift+Enter adds a line; IME composition is respected. Preserve current request cancellation and error/retry behaviour.

+ menu initially contains Attach AEGIS card and View attached context. Card picker uses existing card references and revisions, not arbitrary copied facts. Only add Upload files once storage, limits, content handling and backend authorisation exist. Do not add microphone/voice, web-search, model modes or upload buttons that silently do nothing. Busy, denied, disabled and empty states need explicit text.

## Backend handoff to SNET

Inspection: ChatPanel currently creates conversationId through useState(crypto.randomUUID()) per mount. Helper requests carry this ID; messages are stored according to SOP-006. No authenticated conversation list/search/reopen/delete routes were found in this review. Confirm current schema and migration needs before coding; avoid splitting helper and workspace chat histories accidentally.

Proposed contract (not existing endpoints):
- GET /api/conversations?q=&cursor=&limit= : owned conversations, title, created/updated time, cursor and safe excerpts.
- POST /api/conversations : create thread without a model call.
- GET /api/conversations/:id : paginated ordered messages, roles, blocks, notices, card refs, provenance and interrupted/cancelled status.
- PATCH /api/conversations/:id : user rename.
- DELETE /api/conversations/:id : owner/tenant-checked deletion with documented retention/audit semantics. Deletion must not alter incident cards or immutable evidence.
- Existing helper/chat send endpoints accept/validate the owned thread ID; server creates user-visible message and attachment links in the correct thread. Conversation titles can derive deterministically from first user text; no new paid model call.

SNET owns schema, migration, persistence, endpoint authorisation, search, retention and public-share contracts. SOL owns shared store/hooks, sidebar/account/header/composer/context panels, accessibility and browser tests. Backend absence may use explicit fixtures for review, never simulated live persistence.

## Formulations and SOP

Define reusable recipes for ChatSidebar, RecentChatRow, AccountMenu, ConversationHeader, ChatComposer and SessionContextPanel under the existing UI formulation registry. Menus share dimensions, surfaces, icons and keyboard behaviour. Add a chat workspace interaction SOP alongside SOP-006; helper scope, provider rules, source restrictions and financial controls remain unchanged. Register new controlled documents. Keep data and UI contracts separate so cards can be reused across map, chat and pages.

## Delivery order

1. SNET confirms conversation contract and deletion/retention semantics. SOL produces shell/layout fixture against this SOW without provider calls.
2. Shared account relocation and compact column-3 header; retain navigation and guest flow.
3. Conversation persistence/new/reopen/search/rename/delete wired to real endpoints.
4. Composer + card picker, current cancel flow and session-context panel.
5. Reviewed local copy/export. Public links only with implemented permission/revoke contract.
6. Validate desktop three-column, resized/collapsed panels, phone drawer, keyboard, source provenance and ownership boundaries. Rebuild localhost; report local versus hosted separately.

## Acceptance

- One account entry, fixed at bottom; search and > Recent immediately above it.
- Existing three-column layout and shared style remain; no empty former-login strip above column 3.
- Reopen after reload restores the correct thread; selection survives ordinary page navigation. New chat does not erase history.
- Search, rename and delete act only on authorised conversations; error/cancel states do not falsely report success.
- No map/country/reader movement caused by history, account or panel controls.
- + attaches exact card revisions; context/provenance displays only recorded sources. No secret/system prompt/debug trace exposure.
- Copy/export never silently publishes; public-share endpoint withheld until its contract is implemented.
- Focus returns after closing popovers; Escape closes, menu keyboard navigation works, touch targets remain usable, no horizontal overflow.
- Relevant frontend/browser and backend ownership/deletion/search tests pass; no paid model calls needed for UI verification.

## Local implementation update (rev0.2)

C0022 supersedes the proposed response shapes and fixture staging. The UI now calls authenticated conversation routes and renders stored blocks with text-only fallback; runtime fixtures were removed. SOP-007 defines the interaction rules. Share remains local-only. Main Assist history uses /api/helper; the older card-workspace /api/chat path remains its existing workflow and is not advertised as the saved helper history. Missing email in a session is shown explicitly. Local/hosted validation is reported in the work log; no hosted deployment is included.
