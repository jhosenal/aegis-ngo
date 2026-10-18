# AEG-ADR-008: Standard chat access and Pro operational tools

Date: 2026-10-18. Status: ACCEPTED OWNER POLICY; implementation locally verified. Owner: product owner; implementation: Dsol following the explicit patch request. Related requirement: AEG-REQ-017 (permissions); existing credit/sample features AEG-CREDIT-001 and AEG-SAMPLE-001.

## Decision

Owner instruction: Standard accounts may view information and use AI chat. Operational tools, including custom pin dropping and saved places, require Pro or Admin access. Administrator controls remain administrator-only. Signing up cannot grant a paid/privileged plan or create a purchase.

| Capability | Standard | Pro | Admin |
|---|---|---|---|
| View public information and permitted tenant data | Yes | Yes | Yes |
| AI chat and own conversation create/rename/delete | Yes, within usage limits | Yes, within usage limits | Yes, within usage limits |
| Flash | Yes when enabled | Yes when enabled | Yes when enabled |
| Flash-Lite / Argon / premium modes | No | When enabled and gated | When enabled and gated |
| Drop a custom pin, including a sample pin | No | Yes | Yes |
| Custom location lookup, saved places and demo credits | No | Within service/spend limits | Within service/spend limits |
| Other operational API mutations / assessments | No | Existing operational role and ownership rules also apply | Existing role and ownership rules also apply |
| User privileges, budgets and administrator controls | No | No | Existing administrator checks apply |

The server uses current stored `plan=pro` or `isAdmin=true`. A coordinator role alone and the legacy registered-model-user configuration do not establish a Pro account. Request bodies, client controls and model proposals cannot grant privilege.

Authenticated Standard API writes default to refusal except explicit chat/helper and own-conversation operations. Credit/bookmark APIs and the sample custom-pin endpoint are protected even where the route method is GET. Chat-dispatched resource assessment checks the same capability before running a workflow. Existing tenant ownership, operational role, budget, provider-enable, approval and publication checks remain in effect; Pro does not override them. Sessions re-read account flags, so revocation applies without creating a new session.

The pin toolbar is locked for guests/Standard accounts. Custom map events cannot activate a pin or run a lookup through that UI. Sample custom pins now require Pro/Admin authentication; public browsing of existing sample readings remains available.

## Signup and terms

Show the access summary before terms acceptance, including Standard chat limits, Pro/Admin operational tools, Admin-only controls and no automatic purchase/upgrade. Terms version `2026-10-18-draft-7` records this material access change, so the existing returning-user flow requests renewed acceptance. The owner grants/revokes access; no payment integration is added.

Clear registration benefits and limits follow [NN/g registration guidance](https://www.nngroup.com/articles/checklist-registration-login/). Deny-by-default server enforcement follows [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). These are design/security practices, not an ISO certification or a universal legally mandated signup SOP.

## Verification and deployment boundary

Test anonymous/Standard refusals, allowed Pro/Admin actions, Pro refusal at Admin controls, immediate revocation, body-supplied privilege rejection and chat/DOM-event bypass attempts. Keep existing operational/tenant tests meaningful by explicitly provisioning Pro only in their isolated test databases; production seeds and signup remain Standard.

All provider responses in these tests are local fixtures; no Google lookup, model call or GPU execution is authorized by this change. Source evidence and final outcomes are recorded in the work log and local review receipt. Deployment, traffic and rendering remain on hold. Current process-local OAuth and ephemeral database limitations are unchanged.

Local verification:993application tests passed (412integration),17targeted browser tests passed, no skipped/failed tests. Type checks, UI build, secret scan and source docs pass. Receipt: records/reviews/AEG-ACCESS-001_2026-10-18.json. No live deployment.
