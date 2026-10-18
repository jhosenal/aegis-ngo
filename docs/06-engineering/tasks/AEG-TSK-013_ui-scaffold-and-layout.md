# AEG-TSK-013 — UI scaffold, login, layout, static serving

| Field | Value |
|---|---|
| Requirements | AEG-REQ-007, AEG-UXD-001, AEG-TST-007 |
| Depends on | TSK-009 |
| Owned paths | `ui/index.html`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/src/main.tsx`, `ui/src/App.tsx`, `ui/src/api/client.ts`, `ui/src/state/store.ts`, `ui/src/styles.css`, `ui/src/components/LoginBar.tsx`, `Workspace.tsx`, `Divider.tsx`, `Dock.tsx`, `Sheet.tsx`, `NoticeBar.tsx`, `src/api/staticUi.ts`, `tests/integration/static-ui.test.ts` |
| Read | ENG-006 sections 1, 2, 5, 6 |
| Gate | `npm run gate -- TSK-013` |

## Steps
1. `npm install react react-dom` and `npm install -D vite @vitejs/plugin-react @types/react @types/react-dom`.
2. Create the Vite project files as ENG-006 section 1. Strict TypeScript. `import type` only from `src/types/domain.ts`.
3. `api/client.ts`: typed `fetch` wrapper that adds the bearer token, parses the error envelope into an `ApiError(code, message)`, never swallows errors.
4. `store.ts`: `useReducer` state (session, cards list, pins, selected card, attachments, chat messages, status strip).
5. `LoginBar`: demo login selector populated from a constant list of the three seeded user ids with display names; calls `POST /api/session`; shows user, tenant, role; status strip from `GET /api/health`.
6. `Workspace` + `Divider`: desktop grid and keyboard-resizable divider; mobile: chat main, `Cards (n)` button opening `Sheet`, `Dock` with chips and `+N` overflow, focus trap and restore. All test ids from ENG-006 section 6 that belong to these components.
7. `src/api/staticUi.ts`: register `@fastify/static` for `ui/dist` when the folder exists, with SPA fallback for non-`/api` GET routes; call it from `createApp` (small edit to `src/api/server.ts` is permitted ONLY to add this one call).
8. Placeholder panels for incident list and chat are allowed (filled by TSK-014).

## Tests
`npm run build:ui` exits 0; `tests/integration/static-ui.test.ts` starts the app with `inject`, asserts `GET /` returns the built `index.html` with the CSP header and `GET /api/health` still returns JSON and `GET /nonexistent-route` falls back to the app shell while `GET /api/nonexistent` returns the JSON 404 envelope.
Gate commands: typecheck, `npm run build:ui`, the integration test.

## Do not
Use any UI library, router, CSS framework, `dangerouslySetInnerHTML`, or `localStorage` for tokens (keep the token in memory).
