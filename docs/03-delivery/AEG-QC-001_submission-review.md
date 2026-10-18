# AEG-QC-001 — Submission source review

Date: 2026-10-19 (Malaysia) | Status: SOURCE REVIEW, not a production seal

## Findings and corrections

The public repository initially contained only README.md at commit `c633b75756b57f75f286a81103bc4783c5830390`. Its setup instructions named files that were not published, and its hosted-status section described an obsolete revision. This source package was prepared from the current working files using the explicit GitHub export allowlist, without importing private Git history.

The review corrected the README, added a judge/developer walkthrough and third-party/security notices, added a tracked-file publication guard, and fixed the news-camera plan's TypeScript annotation. The browser bundle built before that annotation correction, but a complete UI type check correctly caught it. This is a new review dated 19 October, not backdated contest evidence.

## Executed checks

| Check | Result |
|---|---|
| Independent source dependency installation | `npm ci --ignore-scripts` completed; native SQLite loaded through the application tests |
| Application tests | 975 passed, 0 failed, 20 skipped/unverified; 995 total |
| Release integrity/policy checks | 14 passed, plus the new public-file boundary regression passed |
| UI TypeScript | Passed after the annotation correction |
| UI build | Passed; existing large-bundle warning remains |
| Source documentation links | Passed including the added submission documents |
| Secret scan | No findings in prepared tracked source |
| Additional credential/history scan | No matches for local credential values or checked token patterns in the two repositories that were public when review began; prepared source also clean |
| npm dependency audit | 0 reported vulnerabilities at review time |
| Hosted page and health | HTTP 200; revision `aegis-demo-00060-pet` at 100% |
| Demo-video link | Public YouTube oEmbed resolves to the AEGIS NGO video; full viewing and exact duration not verified here |
| Browser suite | 31 passed, 3 failed, 127 skipped/not reached after the three-failure limit; 104 seconds |
| Live Google sign-in / paid chat / GPU / invoice | Not executed by this review |

The 20 skipped tests depend on private pricing evidence absent from the public source export. A successful application suite does not verify those prices. Historic browser failures are described in [the existing triage](../06-engineering/v5-browser-failure-triage.md); current full release QC must pass before a production seal is claimed. No production seal, cloud deployment or live traffic change is part of this submission review.

Current browser failures: `aegis.spec.ts:74` could not find the assessment shortfall field; `chat-cancel.spec.ts:30` could not find the `mode-auto` control; `chat-cancel.spec.ts:82` timed out in the phone Cancel-button check. These remain unresolved; the review does not dismiss them as harmless. The owner explicitly approved public source publication with these results on 19 October. Publication is not production acceptance.

## Public/private boundary

The export permits the four cost configuration JSON files, two Assist release JSON files, `records/reviews/AEG-MEDIA-*.json`, public-feed evidence under `records/sources/`, and required `research/engineer/` source. It excludes the private cost ledger, `.env`, keys, databases, runtime `data/`, screenshots, e2e records, design references, baselines and snapshots. `.env.example` contains blank/example credentials only. The original internal commit history is not published.

GitHub secret scanning, push protection, dependency alerts and private vulnerability reporting are enabled. These controls are not a guarantee that all vulnerabilities have been found.

## Submission items still requiring owner confirmation

- Rendered page 10 of the supplied PDF contains real screenshots; extracted placeholder text is hidden underneath them. Page 13 visibly retains stale instructions to insert the demo link and verify the former deployment; the links themselves are present.
- Confirm the demo is under three minutes and the Hack2skill form contains the intended deck, video and repository links.
- The official website lists 18 October as the submission date; the owner supplied a portal cutoff of 02:29 on 19 October Malaysia time. This review does not verify portal submission or eligibility.
- Confirm required team/eligibility details in the portal. A repository audit cannot establish those facts.
- Media/source licences marked unverified, durable Cloud Run storage, first-time Google consent and complete browser acceptance remain open.

Official requirements: [submission and judging criteria](https://aibuildercup.com/themes.html), [FAQ including public GitHub and video requirements](https://aibuildercup.com/Faqs.html).
