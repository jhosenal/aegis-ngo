import type { LegacyEntry } from './lifecycle.js';

/**
 * The reviewed legacy allowlist (Astra, 2026-10-13: "one exact hash-bound legacy entry preserving existing scope and authority, with no expansion").
 * Exactly one row: the frozen AEG.F.RESOURCE-SHORTFALL/1.0.0. Today the row is executed by the resource-assessment workflow with no tenant, purpose,
 * jurisdiction, resource or validity restriction and as a planning calculation, so the entry records that same breadth and nothing wider: use PLANNING
 * (never an operational or decision use), wildcard scopes only where the current code is unscoped, no actions.
 * The three hashes are pinned. If the frozen definition, its implementation file or the lockfile changes, adoption is refused until a new review.
 * implementationHash / dependencyHash are PROPOSED bindings (sha256 of the formulation source file and of package-lock.json, read as raw bytes); the
 * trusted binding resolver at integration time must confirm or replace them. They are not a release approval.
 */
/**
 * Astra, 2026-10-14: the proposed implementation and dependency bindings REQUIRE trusted-resolver verification before integration.
 * This stays false until a trusted resolver has confirmed or replaced them; a test fails if it is set to true without that record.
 */
export const BINDINGS_VERIFIED_BY_TRUSTED_RESOLVER = false;

export const LEGACY_ALLOWLIST: readonly LegacyEntry[] = Object.freeze([
  {
    formulationId: 'AEG.F.RESOURCE-SHORTFALL',
    version: '1.0.0',
    definitionHash: 'efc2bfbcbe109575a1b486e09461a2231f5b3f7e4a6cb5b5d46255d0bc3521de',
    implementationHash: '5d439bfb3614dfc093105fb7987b31426568f2a071a65599787ee6740766ae4b',
    dependencyHash: '3e84abbb3ecb0dd3b01ed63d41e56b3163b7fbe477c5cefd6b9a138fa45c0803',
    use: 'PLANNING',
    scope: { tenants: ['*'], purposes: ['*'], jurisdictions: ['*'], resources: ['*'], validity: ['*'], actions: [] },
    reviewedBy: 'astra',
    evidenceRef: 'S0006',
  },
]);
