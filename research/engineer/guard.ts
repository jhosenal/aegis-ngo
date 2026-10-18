// Isolated proof of concept: ONE mandatory execution guard for a composition. It binds together
//  - the composition's own grant, which is bound to the exact composition identity (graph, bindings, exclusion policy, resolved closure);
//  - every member of the RESOLVED transitive dependency closure, each checked by the lifecycle guard (stage, hashes, expiry, use and FULL scope);
//  - the trusted registry's view of every definition.
// A single failure anywhere denies the whole run, and the run is recorded with the revision of every member in one immediate transaction.
import { z } from 'zod';
import { definitionHash, LifecycleError, authorizeExecution, parseInstant, ScopeSchema, toInstant, type ExecutionRequest, type Revision, type Trust } from './lifecycle.js';
import { compositionHash, dependencyClosure, validateGraph, type Graph, type TrustedDefinitions } from './graph.js';

type Db = import('better-sqlite3').Database;

const wide = (list: string[], value: string): boolean => list.includes('*') || list.includes(value);
const USE_RANK = { DEMO: 1, PLANNING: 2, OPERATIONAL: 3 } as const;

export const CompositionGrantSchema = z.object({
  compositionHash: z.string().regex(/^[0-9a-f]{64}$/), use: z.enum(['DEMO', 'PLANNING', 'OPERATIONAL']), scope: ScopeSchema,
  expiresAt: z.string(), revoked: z.boolean(), approver: z.string().regex(/^[A-Za-z0-9_.@-]{1,128}$/),
}).strict();
export type CompositionGrant = z.input<typeof CompositionGrantSchema>;

export interface CompositionRequest { use: 'DEMO' | 'PLANNING' | 'OPERATIONAL'; tenant: string; purpose: string; resource: string; jurisdiction: string; validity: string; action?: string }
export interface CompositionAuthorization { authorized: boolean; reasons: string[]; members: Record<string, Revision | null>; identity: string | null }

const split = (id: string): { formulationId: string; version: string } => { const at = id.lastIndexOf('@'); return { formulationId: id.slice(0, at), version: id.slice(at + 1) }; };

export function authorizeComposition(
  db: Db, graph: Graph, trusted: TrustedDefinitions, numericPolicyId: string, units: Record<string, string>, request: CompositionRequest, grant: CompositionGrant | null, trust: Trust,
): CompositionAuthorization {
  const reasons: string[] = [];
  const members: Record<string, Revision | null> = {};
  const deny = (why: string[]): CompositionAuthorization => ({ authorized: false, reasons: [...new Set(why)].sort(), members, identity: null });

  const check = validateGraph(graph, trusted);
  if (!check.ok) return deny(check.errors.map((e) => `GRAPH:${e}`));
  const { closure, errors } = dependencyClosure(graph, trusted);
  if (errors.length > 0) return deny(errors.map((e) => `CLOSURE:${e}`));
  let identity: string;
  try { identity = compositionHash(graph, numericPolicyId, units, trusted); } catch (error: unknown) { return deny([`IDENTITY:${(error as Error).message}`]); }

  // The composition's own approval, bound to this exact identity.
  const parsed = CompositionGrantSchema.safeParse(grant);
  if (!parsed.success) reasons.push('MISSING_COMPOSITION_GRANT');
  else {
    const g = parsed.data;
    const nowMs = trust.clock();
    if (g.compositionHash !== identity) reasons.push('COMPOSITION_IDENTITY_CHANGED');
    if (g.revoked) reasons.push('COMPOSITION_GRANT_REVOKED');
    if (parseInstant(g.expiresAt) <= nowMs) reasons.push('COMPOSITION_GRANT_EXPIRED');
    if (USE_RANK[request.use] > USE_RANK[g.use]) reasons.push(`COMPOSITION_USE_ABOVE_GRANT_${g.use}`);
    if (!wide(g.scope.tenants, request.tenant)) reasons.push('COMPOSITION_TENANT_OUT_OF_SCOPE');
    if (!wide(g.scope.purposes, request.purpose)) reasons.push('COMPOSITION_PURPOSE_OUT_OF_SCOPE');
    if (!wide(g.scope.resources, request.resource)) reasons.push('COMPOSITION_RESOURCE_OUT_OF_SCOPE');
    if (!wide(g.scope.jurisdictions, request.jurisdiction)) reasons.push('COMPOSITION_JURISDICTION_OUT_OF_SCOPE');
    if (!wide(g.scope.validity, request.validity)) reasons.push('COMPOSITION_VALIDITY_OUT_OF_SCOPE');
    if (request.action !== undefined && !g.scope.actions.includes(request.action)) reasons.push('COMPOSITION_ACTION_NOT_PERMITTED');
    if (!trust.authority(g.approver, 'advance', 'active')) reasons.push('COMPOSITION_APPROVER_NOT_AUTHORIZED');
  }

  // Every member of the resolved closure, each through the lifecycle guard.
  for (const id of closure) {
    const { formulationId, version } = split(id);
    const row = db.prepare('SELECT formulation_id, version, algorithm_hash, spec_json FROM formulation_registry WHERE formulation_id = ? AND version = ?').get(formulationId, version) as
      { formulation_id: string; version: string; algorithm_hash: string; spec_json: string } | undefined;
    if (!row) { reasons.push(`MEMBER_NOT_REGISTERED:${id}`); members[id] = null; continue; }
    const def = trusted.get(id);
    if (def && def.definitionHash !== definitionHash(row)) reasons.push(`TRUSTED_DEFINITION_MISMATCH:${id}`);
    const input: ExecutionRequest = { formulationId, version, use: request.use, tenant: request.tenant, purpose: request.purpose, resource: request.resource,
      jurisdiction: request.jurisdiction, validity: request.validity, ...(request.action !== undefined ? { action: request.action } : {}) };
    const auth = authorizeExecution(db, input, trust);
    members[id] = auth.revision;
    for (const reason of auth.reasons) reasons.push(`${id}:${reason}`);
  }
  return { authorized: reasons.length === 0, reasons: [...new Set(reasons)].sort(), members, identity };
}

/** Authorization and the work share one immediate transaction; a stop recorded before the work commits blocks it, and every member's revision is recorded. */
export function guardedCompositionRun<T>(
  db: Db, graph: Graph, trusted: TrustedDefinitions, numericPolicyId: string, units: Record<string, string>, request: CompositionRequest, grant: CompositionGrant | null, trust: Trust, work: () => T,
): { result: T; authorization: CompositionAuthorization } {
  const run = db.transaction(() => {
    const authorization = authorizeComposition(db, graph, trusted, numericPolicyId, units, request, grant, trust);
    if (!authorization.authorized) throw new LifecycleError('NOT_AUTHORIZED', authorization.reasons.join(','));
    const result = work();
    const insert = db.prepare('INSERT INTO formulation_runs (formulation_id, version, use, formulation_seq, head_seq, head_hash, ran_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [id, revision] of Object.entries(authorization.members)) {
      const { formulationId, version } = split(id);
      const r = revision as Revision;
      insert.run(formulationId, version, request.use, r.formulationSeq, r.headSeq, r.headHash, toInstant(trust.clock()));
    }
    return { result, authorization };
  });
  return run.immediate();
}
