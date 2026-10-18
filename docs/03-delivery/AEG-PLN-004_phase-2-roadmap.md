# AEG-PLN-004 — Phase 2 roadmap (draft for the owner)

| Field | Value |
|---|---|
| Document ID | AEG-PLN-004 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-18 |
| Written for | the owner (Jhosen Choong), for the slides and for planning Phase 2 |
| Date rule | **Only the owner's date is written down: Phase 2 target 1 November 2026.** Nothing below is promised for that date; each row says what must exist first. Dates for the other rows are to be agreed with the owner |

## 1. How the phases are cut

| Phase | What it is | State on 2026-10-18 |
|---|---|---|
| 0 | Make what exists honest and recoverable (labels, failover, error states) | Done for the map and the summary tiles; AEG-MAP-HARDEN-067 and AEG-TILES-077 |
| 1 | One working path on real, sourced data (the pilot: Singapore, Malaysia, Brunei) | The competition build: alert pipeline, human approval step, AHA, USGS and GDACS cards, evidence labels |
| 2 | Connect the sources that are shown today as stubs. A source counts as connected only when it has a named publisher, a licence check, a stored copy with a hash, and tests | Starts after the competition. Owner target: 1 November 2026 |
| 3 | Scale and operate: more countries and languages, native review, monitoring, cost controls | Not planned in detail |

A stub on the page says what is planned and which source is missing. It never shows a number that has no source.

## 2. Phase 2 work

| # | Item | What the page shows today | What must exist first | Owner of the missing piece |
|---|---|---|---|---|
| 1 | **Resource readiness** (inventory, deployment status, transport tracking) | Panel marked "Phase 2", no numbers | A named source for each of the three (who holds the stock lists, who reports deployments, who tracks transport) and its licence. Today none is chosen | Owner (sources); SNET (ingest, evidence, tests) |
| 2 | **Stored evidence for the AHA reports** | A "Cited source (no stored copy)" block on each card | Save each report page with a hash in the evidence store; link the cards to it | SNET (small backend change and tests) |
| 3 | **At-risk communities** | "Families affected", a sum of figures the AHA reports state | A community or household registry from an official source. None is connected | Owner (source) |
| 4 | **Brunei and Singapore official notices** | AHA reports name neither country; Malaysia shows four MET Malaysia statements only in the data file | An official feed or saved notices from each country's weather and disaster agency, with licence | Owner (access); SNET (adapters) |
| 5 | **Offline-capable map** | Google map, with a schematic fallback if Google fails | Self-hosted OpenStreetMap-based tiles (MapLibre and PMTiles) per AEG-ENG-012 phase 1; Google tiles are never cached | SNET |
| 6 | **Stronger meaning checks** | The no-strengthening rule applies to the Argon script review | Apply the same check, as warnings, to back-translations and hand edits; a human still approves every language | SNET |
| 7 | **Native-reader review** | Translations carry "not reviewed by native speakers" | Readers for Malay, Mandarin and Tamil | Owner |
| 8 | **Data confidence formula** | A provisional feed-health score | The owner's fine-tuning of weights and thresholds (weaknesses in C0011) | Owner and SNET |
| 9 | **Main assistant on Gemini** | The assistant is not on Gemini; only the script review is | A paid Gemini key or Vertex route, and the 87-case rerun (AEG-BRF-003) | Owner (key); SNET |
| 10 | **Hosted site features** | The hosted site runs an older build until Dsol deploys | Dsol's deploy and the one-by-one feature enabling (brief O0006) | Dsol |
| 11 | **User validation** | No user result is claimed | 5 to 8 real people through the validation sprint (AEG-BRF-005) | Owner |

## 3. Order and dependencies

1. Items 2, 6 and 5 need no outside data, so they can start first.
2. Items 1, 3 and 4 wait for sources and licences; until then they stay stubs.
3. Items 7, 9, 10 and 11 depend on people or accounts outside the code.
4. Item 8 is a decision, not a build.

## 4. Wording for the page and the slides

- Page stub: "Planned for Phase 2. No data source is connected yet." Add "Target: 1 November 2026" only as the owner's plan, never as a promise.
- Slides: "Phase 2 connects the sources shown as stubs today. Each one needs a named publisher, a licence check, a stored copy and tests before it shows a number."

## 5. Not promised

- No date for any item except the owner's Phase 2 target.
- No claim that a source for items 1, 3 or 4 exists.
- Licences for AHA Centre, MET Malaysia and OpenStreetMap use are recorded as UNVERIFIED until the owner confirms terms (OpenStreetMap is ODbL).
