# v5 clean-clone browser run: 63 failures, triage

Source: full Playwright run on `data/github-clean-verify-v5` (153 tests: 79 passed, 63 failed, 11 skipped).
Raw first-error lines are retained locally at `data/ops-o0008/v5-browser-failures-raw.txt` and excluded from the source release under the owner's private-record allowlist.
Labels come from the first error message only. No root-cause analysis was done for the "needs human look" rows. `admin-desk.spec.ts` passed (2/2).

Key: **FIXED** = fixed after this run (test route/locator or real service-worker fix), local pass shown.
**STALE** = first error points to an old selector/route/copy contract after the UI redesign (the element or text the test names does not exist on the page).
**LOOK** = value/text/layout mismatch; could be an intentional change or a real regression, not decided.
Public = public Assist page or shared public shell. Admin = Admin Desk or admin shell.

| Spec file (failures) | Label | Surface | Evidence |
|---|---|---|---|
| assist-chat (10) | FIXED | Public | Tests used `/assist` (now the regional dashboard); shell added a 2nd `chat-input`/`divider`. Now `/assist/guidance` + scoped ids: 10/10 pass |
| assist-page (7) | FIXED | Public | Same route change: 12/12 pass with assist-ui |
| assist-ui (1) | FIXED | Public | Same |
| assist-offline (1) | FIXED (real bug) | Public | Service worker only handled `/assist`; `ui/public/sw.js` now precaches/serves `/assist/guidance` (cache v3): passes |
| domains-page (1) | STALE | Public | expects `assist-chat` after following the link to `/assist`, which is now the dashboard |
| shell-header (6) | STALE | Public (shell) | `.site-header` / "Workspace pages" nav not found on `/assist`, `/domains` |
| overview-desktop (1), overview-mobile (1) | STALE | Public/app | "Hazard domains" nav link not found |
| shared-shell:3 | STALE | Public (shell) | expects 1 `aria-current=page`, finds 2 |
| shared-shell:17 | STALE | **Admin shell** | `.site-header` not found after admin sign-in |
| chat-cancel (4) | STALE | App chat | `chat-cancel` / `chat-input` test ids not present on the page tested |
| chat-map (2) | STALE | App chat | placeholder `Ask AEGIS…` not found (current text "Ask AEGIS about hazards, telemetry, or places...") |
| conversation-workspace (1) | STALE | App chat | wait-for-response/click timeouts on old controls |
| dashboard:25, :128, :210, :242 | STALE | Public dashboard | "About AEGIS", chat message ids, "Continue in Assist" button not found |
| dashboard:184 and mobile-spatial (3) | LOOK | Public dashboard | `.dashboard-assist` sheet state is `peek` where `half` expected, and visible where hidden expected |
| dashboard:102 | LOOK | Public dashboard | 184 map markers where 6 expected (likely live data vs fixture) |
| dashboard:164 | LOOK | Public dashboard | chat error text is "Chat request failed", test expects "Temporarily unavailable" (copy change or lost error mapping) |
| environment-layer (1), map-layer-toolbar (1), incident-trend:40, :82 | STALE | Public dashboard | "Region" combobox not found |
| featured-hazards (3), hazard-history (1) | STALE | Public dashboard | `.featured-hazard-card`, "Historical incidents" heading not found |
| incident-trend:16 | LOOK | Public dashboard | "people potentially affected" shows `~1.2M`, test expects `Unknown` |
| live-cards (1) | LOOK | Public dashboard | GREEN alert count 71 vs expected 15 (data-dependent) |
| pin-dropper:97 | LOOK | Public | banner reads "SIMULATION MODE: Mock Telemetry Active", test expects "SAMPLE DATA" (wording change) |
| news-reader:6 | LOOK | Public | progress 99.99% vs 100% (rounding/timing) |
| news-reader:52, reader-controls (1) | STALE | Public | "Chinese subtitles" / "Subtitle language" controls not found |
| overview-map-corrections:37 | LOOK | Public | overlap measurement 201 vs limit 193 (layout) |
| version-label (1) | LOOK | Public shell | version label y-offset 974 vs < 16 (label moved or test assumes old sidebar) |

Totals from the raw 63 failure lines and these row labels: FIXED 19; STALE 32; LOOK 12. No outstanding LOOK item is proven to be a product regression; the Assist offline service-worker bug was fixed. `admin-desk.spec.ts` passed; the remaining admin-shell failure is included in shared-shell:17.

## v7-r4 clean-clone browser run (43 failed, 98 passed, 11 skipped)

Not a regression proof; classification is from the failing assertion, not a fix. STALE = stale route/selector against the new shell. LOOK = needs a human look.

| Spec file | Class | Note |
|---|---|---|
| aegis:74 (AEG-TST-007) | LOOK | shortfall text not found when models are disabled; first hidden failure |
| chat-cancel:30, :49, :68, :82 | STALE | Cancel/lock controls not found (known from v5); :30 was the second hidden failure |
| chat-map:5, :58 | STALE | chat/map selectors |
| conversation-workspace:3 | STALE | workspace selectors |
| dashboard:25, :102, :128, :164, :184, :210, :242 | STALE (:164 LOOK) | shell/dock selectors; :164 copy "Chat request failed" |
| domains-page:36 | STALE | haze guidance link |
| environment-layer:16, featured-hazards (3), map-layer-toolbar, live-cards, incident-trend (3) | STALE (live-cards, incident-trend:16 LOOK) | Region combobox / card selectors; data-dependent counts |
| mobile-spatial (3), overview-desktop, overview-mobile, overview-map-corrections:37 | STALE (:37 LOOK) | sheet attributes, layout measurement |
| reader-controls, scene:78, shared-shell, shell-header (6), version-label | STALE (version-label LOOK) | subtitle/shell selectors, label position |
| hazard-history:162 | LOOK | "Historical incidents" heading is rendered only in the workspace incident view (Dashboard.tsx, iew==='incident' && hazardFilter); /?view=incidents&hazard=seismic now lands on the public page. Needs the intended route confirmed; spec not weakened. |
| news-reader:66 | LOOK | times out (30 s), not a Maps referrer error; the local fixture key is empty. Needs a step-by-step trace. |
| news-reader:6 | LOOK | progress 99.99% vs 100% |

Not verified against the final-config hosted revision (no GCP access this session). The I3 specs (hazard-history 42, 63 and the rest) pass. No spec was deleted or weakened. No one-line selector fix was safe to apply without a human look.
