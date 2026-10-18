# AEG-ENG-012 — Map resilience and basemap failover plan

| Control field | Value |
|---|---|
| Document ID | AEG-ENG-012 |
| Revision | 0.1 |
| Status | WORKING_PLAN |
| Date | 2026-10-17 |
| Owner | Codex — frontend |
| Scope | Aegis browser map: provider failure, internet loss and recovery |
| Related | AEG-ENG-010 Google Maps setup; AEG-ADR-007 map dock and helper |

## Purpose

Prepare the Aegis map to remain useful when Google Maps, a tile provider, or the internet connection is unavailable. A fallback must preserve Aegis's own incident and monitoring overlays, identify the basemap and its data age, and avoid implying that stale information is live.

This is a design and delivery plan. No alternate provider, offline tile package, additional key, or server deployment has been selected or installed by this document.

## Current implementation and gap

- The dashboard uses Google Maps JavaScript API as its detailed basemap.
- `Dashboard.tsx` already renders a locally bundled Natural Earth SVG when Google Maps fails to load or is unavailable. It keeps Aegis card markers and controls available, but it is a schematic regional overview. It does not provide streets, satellite imagery, detailed city maps, address search, or routing.
- The current fallback is not a downloaded Google map and does not establish an operational offline tile cache.
- A script/authentication error can be reported today. A tile-only failure after the Google SDK loads needs a separate health signal and fallback trigger.
- Incident cards, locally stored essential places, telemetry, and map imagery are separate data dependencies. Changing the basemap cannot restore unavailable APIs or refresh stale records.

## Recommended target design

Use three explicit basemap modes, with the same Aegis geographic overlays rendered separately from the basemap:

1. **Primary — Google Maps JavaScript API.** Keep the current map and its existing Google attribution. Follow Google's caching and display terms. Do not prefetch, save, or package Google map tiles for offline use.
2. **Network failover — optional Esri basemap service.** Add only if the owner approves its key, usage terms, attribution, quota and costs. This provides a separate hosted service path when Google fails but the operator still has internet. It is not an offline fallback and does not guarantee independent availability.
3. **Local/offline fallback — MapLibre GL JS with an Aegis-managed OSM-derived PMTiles archive.** Build a regional vector tile package from an approved OSM data extract and serve it from Aegis-controlled storage. PMTiles can be read through MapLibre's protocol integration; the archive host must support byte-range requests for efficient access. A local application host covers upstream provider outages while that host remains reachable. To cover a client internet outage as well, package the app shell and selected regional map archive for explicit local download/storage on managed operator devices.

Keep the existing Natural Earth SVG as the smallest last-resort overview if the detailed fallback cannot load. Label it clearly as **schematic map — detailed basemap unavailable**.

### Why this order

- Google's consumer offline downloads are managed inside the Maps mobile app. They are not an offline tile package for this custom browser map. Google Maps Platform policies generally restrict prefetching, caching and storing Google map content; the Map Tiles API specifically disallows offline uses except where an agreement expressly permits them.
- The public `tile.openstreetmap.org` service is not an offline tile source. Its policy prohibits bulk pre-downloads and offline-area features. Use licensed OSM data with a self-managed tile pipeline, or a commercial provider whose contract explicitly permits the intended cache/offline workflow.
- MapLibre is the open-source renderer, not a map-data provider. PMTiles is a packaging/serving option; Aegis still owns updates, hosting, styles, attribution and storage sizing.
- Mapbox GL JS is also a browser renderer. If it uses Mapbox-hosted styles and tiles, it still needs that hosted service and is not by itself an offline failover. Consider it only if Aegis selects a suitable Mapbox product/contract or serves data that the contract permits Aegis to host. MapLibre is the preferred renderer for the proposed self-hosted fallback because it separates the renderer from the tile host.
- Esri is an optional hosted second provider. It has its own credentials, attribution and consumption model, and should not be described as an SLA-backed or outage-proof provider unless Aegis has a contract stating that.

## Degraded-mode behavior

### Failure detection and switching

- Detect SDK load timeout, Google authorization failure, map initialization failure, and sustained base-tile failure separately.
- Use bounded detection and one clear retry action; avoid rapid provider-switch loops. Keep a user-selectable basemap mode so staff can switch during an incident even if automatic detection is inconclusive.
- Switching basemaps must not change or re-geocode incident coordinates. Existing card, monitoring, and nearby-place overlays remain in WGS84 latitude/longitude and are drawn by the Aegis adapter for each renderer.
- A provider switch must clear provider-specific controls and attribution, then display the new provider's required credits. Never label Esri/OSM imagery as Google or cover source credits with Aegis controls.
- On recovery, do not interrupt an operator who manually chose a fallback. Offer a status notice and an explicit return-to-Google action.

### Offline data and user notice

- Cache only Aegis-owned app assets and records under the approved retention rules. Store a `fetchedAt`/source timestamp for each offline record set; show **last updated** and **offline** status beside it.
- Never present a previously fetched hazard, weather, air-quality or place record as current. Keep the original source and provenance on each record.
- Treat basemap availability and Aegis operational data availability as separate health indicators. The map may work offline while hazard feeds, nearby search, account actions or chat do not.
- Keep the local Natural Earth map available even if no detailed package is installed. Do not imply that it supports navigation, street-level response planning, or satellite analysis.

## Tile/data preparation and operating requirements

1. Define the minimum offline footprint and zoom levels: ASEAN-wide orientation plus an owner-selected set of high-detail response areas (initial candidates: Singapore/Johor and other named operational areas). Do not download every country at high zoom by default.
2. Use a clearly licensed OSM regional extract and a reproducible tile-generation pipeline. Record extract source, retrieval time, generator/style versions, coverage, zoom range, archive checksum and refresh date.
3. Host the archive on the same controlled origin or local network as Aegis for site/provider outages. Verify HTTP range support, integrity checks and enough disk capacity for the chosen coverage.
4. For device-offline operation, provide an explicit package download on managed devices, show required disk space, validate the archive checksum, and expose delete/replace/update controls. Verify actual browser storage limits before choosing Cache Storage, IndexedDB, OPFS, or a file-based workflow.
5. Keep two last-known-good packages during refresh so a partial download or generation failure cannot remove the working copy. Roll back by manifest/version, not by silently replacing tiles in place.
6. Publish visible OSM attribution and link to the ODbL information. Review the ODbL implications of distributing a modified/combined database with legal review before public release.
7. Keep Esri/Google API keys restricted to required services and origins. Provider secrets must not be placed in the frontend bundle unless that provider explicitly defines the credential as a restricted public key.

## Delivery phases

| Phase | Deliverable | Exit evidence |
|---|---|---|
| 0 — Existing fallback hardening | Honest schematic label; clear provider/offline status; tile-health detection; manual retry/switch | Browser checks for SDK error, blocked Google tile requests, delayed load and recovery |
| 1 — Local detailed map prototype | MapLibre renderer, Aegis overlay adapter, small OSM-derived PMTiles pilot served locally | Same marker/card interactions, correct attribution, byte-range and checksum checks |
| 2 — Provider failover | Optional Esri hosted adapter behind a controlled provider setting | Failure-injection tests, provider attribution and usage/cost review |
| 3 — Operator offline package | Managed-device PWA/app shell and explicit regional archive download with timestamped local data | Airplane-mode run on target devices; storage, refresh, corruption and rollback checks |
| 4 — Operations | Refresh schedule, monitoring, ownership, recovery runbook and region expansion | Measured refresh duration, package age alert, restore drill and documented operator training |

## Acceptance criteria

- Google script, auth, and tile failures do not blank the map or remove Aegis overlays.
- Aegis can render a detailed local basemap after the external map providers are blocked, when the local Aegis host is reachable.
- A managed device with an installed app shell and approved regional package can display the map and clearly timestamped last-known Aegis records with external connectivity disabled.
- Provider changes do not alter incident coordinates, marker identity, access controls, or provenance.
- Every mode labels its basemap and source timestamp; attribution remains visible at desktop, mobile and fullscreen sizes.
- Tests distinguish map tiles from operational data: no stale reading is shown without its age, and unsupported actions clearly state that connectivity is required.
- No Google tiles are prefetched, copied into PMTiles, or cached outside Google's permitted behavior.

## Decisions still needed before implementation

1. Is a same-site/local-server fallback enough, or must a workstation continue working when it loses access to the Aegis host too?
2. Which areas and zoom levels are essential for offline response? Confirm the proposed Singapore/Johor pilot and the total storage budget.
3. Is a detailed OSM-style street map adequate when Google satellite imagery is unavailable, or is licensed offline imagery a hard requirement?
4. Should Esri be included as an online second provider, after its cost and terms are reviewed, or should the first pilot go directly to local OSM-derived tiles?
5. Which Aegis-owned incident and telemetry records may be retained on an operator device, for how long, and under what sign-out/secure-delete behavior?

## Research sources checked 2026-10-17

- Google Maps JavaScript API policies: https://developers.google.com/maps/documentation/javascript/policies
- Google Maps Map Tiles API policies: https://developers.google.com/maps/documentation/tile/policies
- Google Maps consumer offline-map workflow: https://support.google.com/maps/answer/6291838?hl=en
- OSM Foundation standard tile usage policy: https://operations.osmfoundation.org/policies/tiles/
- OSM Foundation attribution guidelines: https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- MapLibre GL JS PMTiles protocol example: https://maplibre.org/maplibre-gl-js/docs/examples/pmtiles-source-and-protocol/
- PMTiles concepts: https://docs.protomaps.com/pmtiles/
- Mapbox GL JS web-app model: https://docs.mapbox.com/help/dive-deeper/web-apps/
- Esri Basemap Styles service and attribution requirements: https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/introduction-basemap-styles-service/

Terms and provider capabilities can change. Recheck the applicable service agreement and pricing before selecting a provider or generating distributable tile archives.
