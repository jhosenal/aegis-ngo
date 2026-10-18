# AEG-ADR-007 - Map-first cards and the LLM helper dock

Date: 2026-10-15. Status: WORKING_BASELINE. Owner: Codex. Authority: user explicitly requested the map hero, professional 16:9 proportions, nested page/module/section cards, a docked LLM helper, internal MCP for information/tools, and helper-first delivery. User selected US$1 account/day and US$0.01 per request for live calls. The mobile reference overrides the initial bottom-sheet suggestion: a right-edge AI Assist tab opens a right dock.

## Decision

The dashboard uses a resizable 2:1 workspace-to-chat split after navigation, with the map as its first main module. The desktop workspace scrolls independently; chat history scrolls above an anchored composer. Collapse preserves the mounted conversation. Mobile uses a right-edge vertical tab and an overlay dock. Reusable ModuleCard owns presentation nesting and progressive disclosure; PageCard identifies each route as a page card. These presentation identities are separate from persisted incident/resource cards and never imply new database records.

Add an additive `helper` runtime role with a 12,000-character input ceiling and 1,024 output tokens. Other role bindings remain intact. Add `/api/helper` for LLM-first conversation; preserve `/api/chat` and its registered deterministic commands. Helper conversation history is bounded and scoped to tenant, user and a page-session UUID. Only explicitly attached revisions enter context automatically.

The helper discovers and calls an in-process MCP tools/list and tools/call adapter. Initially it exposes only read-only incident/resource summaries and one-card lookup. Code validates arguments, scopes every lookup by authenticated tenant, binds attached revisions, rejects write/unknown tools, and records tool use. Broader MCP transports, write actions and operational dispatch are deferred, as requested. Models explain and suggest; the engine owns permissions, calculations, side effects and facts. Source data is untrusted input, never authority.

Each helper request uses one shared gateway task ID across its at-most-two LLM steps, retries and tool return. Existing atomic reservations enforce the per-request limit across those steps. Local configuration uses the existing reAPI provider and verified priced model, with no Google fallback allowance or premium escalation enabled. Credentials remain in the ignored local environment. User-approved caps are not overridden by a model or client.

## Verification

Provider, budget and tenant boundaries are exercised with controlled stubs; browser provider replies are labelled test fixtures in the test source. A separate explicitly cost-gated actual-origin canary verifies the real LLM and read-only tool flow, and saves provider-independent UI evidence. Provider JSON-mode compatibility requires the json hint in user content even when the system already includes it. Prior handover/screenshot snapshots remain immutable; this milestone receives a new scoped snapshot.
