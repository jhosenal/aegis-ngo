# C0002 — Codex frontend / SNET backend handoff

Date: 2026-10-15. Status: OWNER_ASSIGNED / ACTIVE_COORDINATION. Recorded by: Codex.

The owner explicitly assigned **Codex to frontend** and **SNET to backend**. This note is the shared handoff; it does not claim SNET has read it or completed any work. No message was sent to an external agent service. The owner is arranging SNET's session.

## Ownership

| Owner | Paths / work |
|---|---|
| Codex frontend | `ui/src/`, `ui/public/`, `ui/vite.config.ts`, UI assets, frontend/browser tests, frontend delivery records. Continue the map hero, presenter, seven hazard links and card-section layout. |
| SNET backend | `src/api/`, `src/services/`, `src/data/`, `src/sources/`, `src/providers/`, `src/chat/`, `src/mcp/`, backend configuration/migrations and unit/integration tests. Confirm scope against C0001 and existing contracts before starting a feature. |
| Shared — coordinate first | `src/types/`, `src/domains/` schemas, shared content contracts, package/dependency files, environment/config names, API response schemas, `AGENTS.md`, `HANDOVER.md` and shared delivery log. Claim specific paths and append findings; do not overwrite another agent's work. |

Project is the independent AEGIS workspace, local UI/API origin `http://127.0.0.1:8787/`. Do not modify OAG, SOOS/QZEEX or Storyboard. Existing files are extensively uncommitted/untracked: inspect before editing; do not reset/clean. Do not restart or replace the shared server without coordinating the active test/build. UI asset rebuilds are dynamically served and normally need no API restart.

## Existing frontend contract — preserve compatibility

Authoritative types are `src/types/domain.ts`, `src/types/api-schemas.ts` and the relevant route-specific parsers. The following is a navigation aid, not a replacement schema:

- `GET /api/cards` returns summaries with `cardId` and `latestRevision`. The dashboard then reads each exact revision using `GET /api/cards/:cardId?revision=N`. Preserve source/evidence, revision history and child links in the detail response. The UI uses `ui/src/dashboard/data.ts` and `ui/src/state/store.ts`.
- Card locations are latitude/longitude in microdegrees, validated before map rendering. Keep missing/bad locations explicit; do not invent map positions. Real tenant records and synthetic guest examples remain separate.
- `GET /api/pins`, `PUT /api/pins/:cardId`, `DELETE /api/pins/:cardId` persist tenant-scoped pins. Pinning and attaching a particular revision to chat are distinct actions.
- `GET /api/modes` provides the helper's modes/default. Dashboard Assist uses `POST /api/helper`; other workspace chat uses `POST /api/chat`. `ui/src/components/ChatPanel.tsx` sends text, conversation context/mode and explicit card revision attachments. Preserve `ChatReply` blocks, attachment revisions, provider notices and retry/error behavior.
- API client sends bearer authorization when signed in and expects JSON errors shaped `{error:{code,message,...}}`. Tenant/project scope must come from the authenticated principal, not untrusted request bodies.
- Public `/domains/#domain-1` through `#domain-7` currently show read-only domain guides from `content/domains/catalogue.json`. These are **not** live incident cards or proof that all seven domain engines execute. The new landing links open the corresponding exact article and focus it.
- Public Assist has its own release/content/offline boundaries. Preserve isolation from authenticated tenant data and private API caches.

## Current frontend work / fixtures

1. Hero map uses the live browser Google Maps key, default view including Japan, ASEAN and PNG. The presenter and map camera have explicit screen-space layout; do not change incident coordinates to achieve a UI shift.
2. Seven public hazard guide cards are immediately below the map. Six regional metrics follow in the next section. Unknown metrics remain unknown; demo/stub/source labels must not become live claims.
3. Presenter uses same-origin cached WAV, a transparent 2D portrait and amplitude-driven mouth patch. Play is opt-in. No dynamic Google TTS, avatar video service, news feed or broadcasting is connected by this UI feature.
4. Existing browser tests mock helper replies and use disposable fixture databases on :8799; passing them alone is not proof of real provider/MCP/news integration.

## Backend priorities to scope with owner

Use [C0001](C0001_refined-aegis-scope-of-work.md) as the recorded product direction: accessible/offline public cards plus an NGO/media draft/export pipeline. Reuse existing code before creating parallel modules. Suggested first backend inspection: current card/evidence endpoints, public Assist release/offline behavior, helper debug traces and read-only internal MCP. Identify missing data/calculations explicitly; agree any new aggregate/summary or media endpoint contract with frontend before wiring it.

Preserve code-controlled workflows, provenance, tenant access, audit chain and budget reservations. Models explain validated information; they do not authorize actions or turn unsupported content into facts. Paid generation, production deployment and actual social/message publication need the applicable existing authorization and gates; this division of engineering work is not new publication/spending authority.

## Credentials and operational cautions

- Keep ignored `.env` values private; do not paste them into notes, logs or chat. Frontend Vite environment exports are deliberately restricted to Maps configuration.
- `VITE_GOOGLE_AGENT_API_KEY` is unfortunately named but remains server-only through the Vite allowlist. Existing Agent Platform token-count authentication passed; Gemini Developer API was service-blocked and Cloud TTS authentication was missing at the last check. Do not assume a key authenticates every Google service.
- Preserve existing live-helper budget controls (owner previously selected US$1 total/day and US$0.01/request); inspect current configuration rather than blindly resetting caps or calling a provider outside the gateway.
- Debug routes/logs already exist for chat. Inspect `src/chat/debug.ts`, `src/api/routes/helper.ts` and `tools/chat-debug.ts`; redact secrets and sensitive tenant text.

## Integration acceptance / handback

SNET should report changed endpoints/contracts, migrations/backward compatibility, actual fixture/integration checks, live provider checks separately, source provenance, errors/notices and remaining stubs. Frontend can then wire the real contract and perform browser/mobile verification. Use new immutable evidence snapshots; do not rewrite prior receipts. This assignment does not authorize either agent to claim independent review of its own changes.

## Frontend handback ? 2026-10-16

AEG-NEWS-004 is complete: edge-to-edge hero, presenter placement, seven public domain photo links and six summary cards in the following section. No new API contract is required for the guide strip; it uses the existing public catalogue and detail routes. Twelve browser checks passed; the final photo asset correction was followed by two targeted gallery checks and live Google desktop/mobile verification. Final receipt: `records/reviews/AEG-NEWS-004_2026-10-16_manifest.json`; current review and origin proof use the same date. The earlier backend observation that NEWS-004 lacked a completion/review/manifest was correct at that time and is superseded by this handback. Continue backend work using existing contracts; agree new aggregate/media endpoints with frontend before binding them.
