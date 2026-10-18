# AEG-TSK-022 — Three.js background scene, morphism projection and glass surfaces (SHOULD)

| Field | Value |
|---|---|
| Requirements | AEG-UXD-001, AEG-REQ-005, AEG-REQ-007 |
| Depends on | TSK-015 (accepted) |
| Owned paths | `ui/src/scene/projection.ts`, `ui/src/scene/SceneBackground.tsx`, `ui/src/scene/sceneRuntime.ts`, `ui/src/styles.css` (edit), `ui/src/App.tsx` (edit: mount only), `ui/package` changes listed below, `tests/unit/projection.test.ts`, `tests/browser/scene.spec.ts`, `playwright.config.ts` (edit: Chromium launch flags only) |
| Read | ENG-006 sections 2 and 3; `.agents/v0.7.0/CSCI-SCENE-01.md` in the OAG v0.7 workspace for the declarative scene idea |
| Gate | `npm run gate -- TSK-022` (the engineer adds the gate entry) |

## Engineer approval for a new dependency
ENG-001 section 4 allows no extra dependency without written approval. This card approves exactly one runtime dependency: `three`, pinned to the exact version `0.186.1` (checked on npm on 2026-10-13), plus its types `@types/three` at `0.186.0` as a development dependency. Nothing else: no R3F, no post-processing library, no model or texture downloads. Use only built-in geometry and materials. The bundle may grow by the size of the Three.js modules actually imported (import named modules, not the whole namespace, so Vite can tree-shake).

## Purpose
Three.js gives the workspace a calm 3D background and a presentation layer for the information the cards already hold. It never replaces a card, never carries information that is not also in the 2D view, and never blocks work.

## 1. Morphism projection (the rule that makes the scene honest)
The scene is a typed projection of existing data, not a decoration. In `projection.ts` define, as pure functions with no DOM and no Three.js imports:

```ts
export interface SceneModel { revision: number; tiles: SceneTile[]; ambient: 'calm' | 'attention' }
export interface SceneTile { cardId: string; kind: 'incident' | 'assessment'; heightUnits: number | null; flags: EvidenceFlag[]; label: string }
export function projectCards(cards: CardView[]): SceneModel          // card state -> scene model
export function describeModel(model: SceneModel): string[]           // the same model rendered as plain text lines
```

Rules, each of which must be able to FAIL:
- **Typed and total.** Input is validated; an unknown card kind, a negative or non-integer quantity, or a missing `cardId` throws `AegisError('E_VALIDATION')`. Nothing is silently clamped or defaulted to zero. A null quantity stays `null` (`Unknown`), and the scene draws it as a visibly different outline, never as a zero-height tile.
- **Only what the card already shows.** Height comes only from an assessment card's shortfall units; colour or outline comes only from evidence flags (`STALE`, `SUPERSEDED`, `CONFLICTING`, `COORD_INVALID`, `SYNTHETIC`). No invented values and no data from outside the card list.
- **Commutes with the 2D view.** `describeModel(projectCards(cards))` must contain, for every tile, the same cardId, label, quantity text and flags that `CardView` prints. A test builds cards from the fixtures, renders both, and asserts equality (the diagram card to 3D to text equals card to text).
- **Deterministic.** Same cards in, same model out; no clock, no random, tile order sorted by `cardId`.
- **Untrusted text is data.** Labels are passed to the scene as canvas or sprite text only after being truncated to 40 characters; never as HTML.

## 2. Scene (`SceneBackground.tsx`, `sceneRuntime.ts`)
- One full-viewport `<canvas>` behind the app: `position: fixed; inset: 0; z-index: -1; pointer-events: none`, `aria-hidden="true"`, `tabindex="-1"`. It must never take focus, steal pointer events, or change layout.
- Slow camera drift and soft lighting over a small set of tiles from `SceneModel`. Cap pixel ratio at 1.5 on desktop and 1 on screens below 900 px. Pause the render loop when the tab is hidden (`document.visibilityState`) and when `prefers-reduced-motion: reduce` is set (draw one static frame).
- **Graceful fallback.** If WebGL is unavailable or the context is lost, remove the canvas and show a static CSS gradient. The app must work identically. Log one `console.info`, never an error.
- **Lifecycle.** On unmount dispose geometries, materials and the renderer, cancel the animation frame, and remove listeners. No console errors.
- **Test mode.** When `?scene=frozen` is in the URL, or `window.__AEGIS_SCENE_FROZEN__` is true, render exactly one frame with a fixed camera and time zero, then stop. Screenshots use this mode so they are repeatable.
- **Performance budget.** At most 200 tiles; beyond that, draw the first 200 and the card list is still complete. Never more than one draw loop.

## 3. Glass (morphism) surfaces
- Add CSS variables and a `.glass` class: translucent panel background, `backdrop-filter: blur(...)`, a thin light border and a soft shadow. Apply to the incident workspace, chat panel, login bar and dock, keeping the 2:1 layout, the divider and the mobile sheet exactly as ENG-006 section 2 defines.
- **Readability first.** Text on glass must keep a contrast ratio of at least 4.5:1 against the worst-case scene colour. Provide `@supports not (backdrop-filter: blur(1px))` and `prefers-reduced-transparency: reduce` fallbacks that use an opaque panel. Dark and light schemes both work.
- Status badges, epistemic tags and flag chips keep their text and symbols; colour is never the only signal.

## 4. Tests
- `tests/unit/projection.test.ts` (pure): totals and refusals from section 1; `null` stays `Unknown`; determinism; the commute test; labels truncated to 40 characters and passed as data.
- `tests/browser/scene.spec.ts` (Playwright, Chromium): (a) with WebGL available the canvas exists, is `aria-hidden`, has `pointer-events: none`, and the 8 existing TSK-015 flows still pass with it mounted; (b) with WebGL disabled (launch flag `--disable-gpu` and `--disable-webgl`) the canvas is absent, the fallback gradient is present, and the workspace still works; (c) with `prefers-reduced-motion: reduce` the page renders one frame and no animation loop keeps running; (d) `?scene=frozen` produces identical screenshots across two runs (compare bytes or use `toHaveScreenshot` with a small threshold); (e) text contrast over the glass panels meets 4.5:1 for the main text colour (compute from the computed styles and the frozen frame); (f) the keyboard path and the six-card mobile dock from TSK-015 are unchanged; (g) no console errors on load, resize or unmount.
- For headless WebGL, the engineer allows adding Chromium launch args in `playwright.config.ts` (software GL, for example `--use-angle=swiftshader`, `--ignore-gpu-blocklist`). If WebGL still cannot start in the test browser, test (a), (d) and (e) are marked as skipped with the reason written to the build log, and the status stays `pending` for those, never `fixture-tested`.
- Save new screenshots `records/screenshots/scene-desktop.png` and `scene-mobile.png` (frozen mode, loaded tenant data). They are not an accessibility audit.

## 5. Do not
Do not add a physics or animation library. Do not fetch anything for the scene. Do not put tenant text anywhere except through the 40-character label path. Do not change the existing component props in a way that breaks `tests/unit/ui-render.test.ts` or the TSK-015 tests. Do not describe the scene as "live data" or "real-time"; it reflects the cards the user already loaded.

## 6. Status words
Report `implemented`, `fixture-tested`, `live-tested` (no), `pending`. The visual quality of the scene is judged by the engineer by looking at the screenshots; a PASS gate does not mean the design is accepted.
