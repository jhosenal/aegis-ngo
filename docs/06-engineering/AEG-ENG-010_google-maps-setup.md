# AEG-ENG-010 - Dashboard Google Maps setup

Date: 2026-10-15. Status: implemented and contract-tested; live Google verification pending a dedicated browser key.

The regional dashboard supports Google's Maps JavaScript API, satellite/hybrid imagery, advanced hazard markers, map/satellite controls, pan, zoom and fullscreen. Existing hazard filters and card opening remain controlled by AEGIS. Preview locations remain synthetic; Google imagery does not turn these into verified disaster reports. Signed-in locations still come from tenant-scoped cards, with invalid/out-of-region coordinates excluded.

## Local activation

1. In your own Google Cloud project, enable Maps JavaScript API and billing. Create a separate browser key; do not reuse the model-provider key.
2. Restrict the key to Maps JavaScript API, with website referrers `http://127.0.0.1:8787/*` and `http://localhost:8787/*`. Add development origins only when needed. Manage Maps quotas/budget alerts in that project; the AEGIS LLM spending ledger does not meter browser Maps usage.
3. Put this in the ignored project-root `.env.local`:

   ```dotenv
   VITE_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
   VITE_GOOGLE_MAPS_MAP_ID=your_javascript_map_id
   ```

   Map ID is optional for local testing: Google's `DEMO_MAP_ID` is used when absent. Set your own JavaScript map ID before a production release. This browser key is intentionally sent to Google from the browser and included in the built UI; referrer/API restrictions protect it. Never put a server secret in a `VITE_` variable.
4. Run `npm.cmd run build:ui` and refresh `http://127.0.0.1:8787/`. Key changes require a rebuild; this is build-time configuration. No backend restart is needed for key changes.
5. Confirm the map label reads Google Maps, imagery is present, all seven preview hazard layers work and a marker opens its card. Inspect authorization/referrer errors if Google refuses the request.

Without a configured key, no Google SDK request is made. SDK/network/authentication failures leave an explicitly labelled offline Natural Earth map and working incident-card controls. There is one SDK request per page, with bounded loading and no automatic retries. Google attribution remains visible; local Natural Earth attribution appears only for the offline basemap.

The local API was restarted to apply Maps-specific UI CSP sources and an origin-only cross-site referrer policy. API replies retain their earlier policy/no-referrer behavior. HTML allows the Google Maps script hosts and documented image/connect/font/frame/worker sources; eval is permitted for SDK compatibility, while inline scripts remain blocked. Revisit Google's CSP guidance when expanding Maps features.

## Verification

UI and API typechecks, 17 targeted integration checks and six offline dashboard browser regressions pass. Two dedicated Google SDK contract browser tests pass using a local fixture: marker coordinates, seven layers, filtering, card opening, zoom, one loader request, authorization failure and network failure. They do not prove Google credentials, billing or imagery work.

To reproduce the contract tests in PowerShell (temporary fixture build):

```powershell
$env:VITE_GOOGLE_MAPS_API_KEY='maps-contract-fixture'
npm.cmd run build:ui
$env:AEGIS_MAPS_CONTRACT_TEST='true'
node node_modules/@playwright/test/cli.js test tests/browser/google-maps.spec.ts
Remove-Item Env:VITE_GOOGLE_MAPS_API_KEY
Remove-Item Env:AEGIS_MAPS_CONTRACT_TEST
npm.cmd run build:ui
```

Do not navigate the live local UI during the temporary fixture build. The final rebuild restores your normal configuration. Ordinary dashboard tests use an unconfigured/offline build and no external Maps/LLM calls.

Sources: [SDK loading](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [advanced markers and map IDs](https://developers.google.com/maps/documentation/javascript/advanced-markers/start), [API key restrictions](https://developers.google.com/maps/api-security-best-practices), [CSP guidance](https://developers.google.com/maps/documentation/javascript/content-security-policy).
