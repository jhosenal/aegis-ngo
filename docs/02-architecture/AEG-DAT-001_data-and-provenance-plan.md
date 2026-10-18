# AEG-DAT-001 — Data and provenance plan

| Control field | Value |
|---|---|
| Document ID | AEG-DAT-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Source inventory

| Source | Intended use | Initial status |
|---|---|---|
| GDACS RSS: https://www.gdacs.org/xml/rss.xml | Hazard event metadata, source links | Candidate live adapter; availability/terms/schema to verify |
| HDX API: https://data.humdata.org/api/3/action/package_search | Discover relevant humanitarian datasets | Catalogue discovery; not itself a live event stream |
| NGO resource records | Stock, demand, reserve and local constraints | Synthetic fixtures only initially |
| QZEEX market history | Potential exchange-cost/procurement context | Read-only reference; no bulk import authorized by this package |
| User feed/text | Candidate incident detail | Treat as unverified until validated/reviewed |

HDX datasets have individual licences, coverage and update schedules. A free endpoint does not imply unrestricted redistribution.
GDACS/HDX do not establish current shelter capacity or road passability merely by mentioning a location.

## QZEEX reference

Local database reference: E:/SOOS_QZEEX_v0.8.3/03_DATALINK_SUBSTRATE/MARKETS/MARKET_DATA.db.
Prior planning inspection found historical market data extending back to 2019 in some series. Coverage differs by instrument; latest dates and gaps must be measured per series. A minimum/maximum timestamp is not completeness evidence.
No database or rows are copied in this handover. Use read-only connections and bounded queries. Record table, instrument, interval, timezone, source licence, acquisition date, missingness and allowed uses before importing selected data.
Useful transfer: as-of joins, no-lookahead rules, cost arithmetic, independent recalculation and provenance. Trading strategies are not humanitarian decision rules.

## Normalized evidence record

Required: evidenceId, sourceId, sourceRecordId, sourceUrl, licenceRef, eventTime, publishedAt, fetchedAt, validUntil/freshnessPolicy, region/geography, units, rawArtifactHash, normalizedPayloadHash, adapterVersion, qualityFlags and owner/access scope.
Keep source facts separate from derived calculations and model extractions. Preserve original permitted artifacts or a verifiable permitted reference.
Revision identity includes the source record revision/hash; deduplicate repeated polls without hiding legitimate updates.
Do not assume feed order is event order. Keep scheduled future events separate from observed events.

## Intake controls

Allowlist feed endpoints; bound response sizes, redirects, timeouts and parsing depth. Disable XML external entities. Reject arbitrary internal/private URLs and schema-invalid geometry.
Set polling from source guidance and measured load; 15 minutes is a proposed configurable starting value, not a guarantee of live coverage.
Retry with backoff, cache last valid evidence, show its age and unavailable status. Do not quietly relabel old data as live.
Coordinate reference systems, lat/lon ordering, geographic bounds and timezones need explicit validation.

## Data minimization and retention

MVP uses public incident metadata and synthetic inventory, with no beneficiary identifiers. Real organizational data requires tenant access rules and a retention policy.
For reAPI backup, check whether the data class is permitted to leave the primary provider boundary; redact/minimize first.
Delete raw content according to policy while retaining only legally/permissibly necessary integrity metadata. Hashes of predictable sensitive values can leak information; hashes are not anonymization.

## Initial fixture pack to implement

A valid incident, duplicate update, stale event, changed source record, malformed coordinates, unavailable source, conflicting values and synthetic resource set.
Each fixture has a provenance note and synthetic flag. No resource card should imply it represents a real stocked shelter.


