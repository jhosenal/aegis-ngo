// Isolated proof of concept: typed composition graph, order-independent status aggregation, scope-intersecting permission, composition hash.
import { hashWithDomain } from '../../src/engine/canonical.js';

/** Ordinal comparison of UTF-16 code units. Identifiers are ASCII, so this is a stable, locale-independent order. */
export const ord = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Identifier policy: ASCII letters, digits and _ . @ - only, 1 to 128 characters, no normalization needed. Anything else is rejected, never folded. */
export const ID_PATTERN = /^[A-Za-z0-9_.@-]{1,128}$/;
export const validId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value);
function mustBeId(value: unknown, what: string): string {
  if (!validId(value)) throw new Error(`BAD_IDENTIFIER ${what}`);
  return value;
}

export type Status = 'VALID' | 'UNKNOWN' | 'STALE' | 'CONFLICT' | 'INVALID';
/** Summary precedence, highest first. Warning urgency is a separate field and never enters this ranking. */
export const PRECEDENCE: readonly Status[] = ['INVALID', 'CONFLICT', 'STALE', 'UNKNOWN', 'VALID'];
const RANK = new Map(PRECEDENCE.map((status, index) => [status, PRECEDENCE.length - index]));

export interface InputState { input: string; status: Status; code?: string }
export interface Reason { input: string; status: Status; code: string }
export interface Aggregate { status: Status; reasons: Reason[] }

/** Keeps every per-input reason. The result does not depend on the order in which inputs were visited, and uses an ordinal comparator. */
export function aggregate(inputs: InputState[]): Aggregate {
  for (const item of inputs) { mustBeId(item.input, 'input'); if (item.code !== undefined) mustBeId(item.code, 'code'); }
  const reasons: Reason[] = inputs
    .filter((item) => item.status !== 'VALID')
    .map((item) => ({ input: item.input, status: item.status, code: item.code ?? item.status }));
  reasons.sort((a, b) => (RANK.get(b.status) ?? 0) - (RANK.get(a.status) ?? 0) || ord(a.input, b.input) || ord(a.code, b.code));
  const top = inputs.reduce<Status>((best, item) => ((RANK.get(item.status) ?? 0) > (RANK.get(best) ?? 0) ? item.status : best), 'VALID');
  return { status: top, reasons };
}

export type Applicability = 'APPLICABLE' | 'NOT_APPLICABLE';
/** applicability and reason are metadata, not extensions of the status enum. */
export interface Result<T> {
  status: Status;
  value?: T;                                           // only when status is VALID and the result is complete
  partial?: { value: T; complete: false; missing: string[] };   // a typed known part, never a total
  reasons: Reason[];
  applicability: Applicability;
  reasonCode?: string;                                 // for example ZERO_DURATION or ZERO_POPULATION
}

export function combine<T>(inputs: InputState[], compute: () => T, knownPartial?: () => T): Result<T> {
  const summary = aggregate(inputs);
  if (summary.status === 'VALID') return { status: 'VALID', value: compute(), reasons: [], applicability: 'APPLICABLE' };
  const missing = summary.reasons.filter((reason) => reason.status === 'UNKNOWN').map((reason) => reason.input);
  const result: Result<T> = { status: summary.status, reasons: summary.reasons, applicability: 'APPLICABLE' };
  if (summary.status === 'UNKNOWN' && knownPartial) result.partial = { value: knownPartial(), complete: false, missing };
  return result;
}

// ---------- graph ----------
export type Kind = 'observation' | 'arithmetic' | 'empirical' | 'policy' | 'action';
export interface Port { dimension: string; required: boolean }
export interface Edge { from: string; output: string; to: string; input: string; dimension: string }
/** A constant or an external input declared for a port. Without an edge or one of these, a required port is unbound. */
export interface ExternalBinding { nodeId: string; input: string; source: 'constant' | 'external'; dimension: string; ref: string }
export interface GraphNode {
  nodeId: string; formulationId: string; version: string; kind: Kind;
  inputs: Record<string, Port>;
  outputs: Record<string, string>;           // output name -> dimension
  definitionHash: string; implementationHash: string;
}
export interface Graph {
  graphId: string; nodes: GraphNode[]; edges: Edge[]; bindings?: ExternalBinding[];
  /** The predeclared dependency policy: node ids that will not run in this composition. Bound into the composition identity. */
  exclusions?: string[];
}
/** What the trusted registry says about a formulation version. The graph's own claims are never believed over this. */
export interface TrustedDefinition {
  definitionHash: string; implementationHash: string; dependencies: string[]; inputs: Record<string, Port>; outputs: Record<string, string>;
}
export type TrustedDefinitions = ReadonlyMap<string, TrustedDefinition>;
export const fid = (node: Pick<GraphNode, 'formulationId' | 'version'>): string => `${node.formulationId}@${node.version}`;

export function validateGraph(graph: Graph, trusted?: TrustedDefinitions): { ok: boolean; errors: string[]; order: string[] } {
  const errors: string[] = [];
  const byId = new Map<string, GraphNode>();
  if (!validId(graph.graphId)) errors.push('BAD_IDENTIFIER graphId');
  for (const node of graph.nodes) {
    if (!validId(node.nodeId) || !validId(node.formulationId) || !validId(node.version)) { errors.push(`BAD_IDENTIFIER node ${String(node.nodeId)}`); continue; }
    if (byId.has(node.nodeId)) errors.push(`DUPLICATE_NODE_ID ${node.nodeId}`);      // a unique nodeId, separate from the formulation it invokes
    byId.set(node.nodeId, node);
    if (trusted) {
      const def = trusted.get(fid(node));
      if (!def) errors.push(`UNTRUSTED_DEFINITION ${fid(node)}`);
      else {
        if (def.definitionHash !== node.definitionHash || def.implementationHash !== node.implementationHash) errors.push(`HASH_MISMATCH ${node.nodeId}`);
        const same = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => JSON.stringify(Object.keys(a).sort(ord).map((k) => [k, a[k]])) === JSON.stringify(Object.keys(b).sort(ord).map((k) => [k, b[k]]));
        if (!same(def.inputs, node.inputs) || !same(def.outputs, node.outputs)) errors.push(`PORT_MISMATCH ${node.nodeId}`);
      }
    }
  }
  const excluded = new Set(graph.exclusions ?? []);
  for (const id of excluded) if (!byId.has(id)) errors.push(`EXCLUSION_UNKNOWN_NODE ${id}`);

  const writers = new Map<string, number>();
  const bump = (key: string): void => { writers.set(key, (writers.get(key) ?? 0) + 1); };
  const incoming = new Map<string, number>(graph.nodes.map((node) => [node.nodeId, 0]));
  const next = new Map<string, string[]>(graph.nodes.map((node) => [node.nodeId, []]));
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) { errors.push(`EDGE_TARGET_MISSING ${edge.from}->${edge.to}`); continue; }
    const out = from.outputs[edge.output];
    const inp = to.inputs[edge.input];
    if (out === undefined) errors.push(`NO_SUCH_OUTPUT ${edge.from}.${edge.output}`);
    if (inp === undefined) errors.push(`NO_SUCH_INPUT ${edge.to}.${edge.input}`);
    if (out !== undefined && inp !== undefined && (out !== edge.dimension || inp.dimension !== edge.dimension)) {
      errors.push(`DIMENSION_MISMATCH ${edge.from}.${edge.output}(${out}) -> ${edge.to}.${edge.input}(${inp.dimension}) declared ${edge.dimension}`);
    }
    if (excluded.has(edge.from) && !excluded.has(edge.to)) errors.push(`EXCLUSION_REMOVES_DEPENDENCY ${edge.from} feeds ${edge.to}`);   // a data-producing dependency cannot be excluded
    bump(`${edge.to}.${edge.input}`);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    next.get(edge.from)?.push(edge.to);
  }
  for (const binding of graph.bindings ?? []) {
    const node = byId.get(binding.nodeId);
    const port = node?.inputs[binding.input];
    if (!node || !port) { errors.push(`BINDING_TARGET_MISSING ${binding.nodeId}.${binding.input}`); continue; }
    if (port.dimension !== binding.dimension) errors.push(`DIMENSION_MISMATCH binding ${binding.nodeId}.${binding.input}`);
    bump(`${binding.nodeId}.${binding.input}`);
  }
  for (const node of byId.values()) {
    if (excluded.has(node.nodeId)) continue;
    for (const [name, port] of Object.entries(node.inputs)) {
      const count = writers.get(`${node.nodeId}.${name}`) ?? 0;
      if (count > 1) errors.push(`MULTIPLE_WRITERS ${node.nodeId}.${name}`);
      if (count === 0 && port.required) errors.push(`UNBOUND_REQUIRED_INPUT ${node.nodeId}.${name}`);
    }
  }
  const order: string[] = [];
  const ready = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort(ord);
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    for (const target of [...(next.get(id) ?? [])].sort(ord)) {
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) { ready.push(target); ready.sort(ord); }
    }
  }
  if (order.length !== graph.nodes.length) errors.push('CYCLE');
  return { ok: errors.length === 0, errors, order };
}

/**
 * The resolved dependency closure: every formulation version of every executing node, plus all NESTED dependencies, taken from the trusted
 * registry and never from a caller-supplied flat list. Excluded nodes (by the predeclared policy) are left out; nothing else is.
 */
export function dependencyClosure(graph: Graph, trusted: TrustedDefinitions): { closure: string[]; errors: string[] } {
  const errors: string[] = [];
  const excluded = new Set(graph.exclusions ?? []);
  const seen = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (trail.includes(id)) { errors.push(`DEPENDENCY_CYCLE ${[...trail, id].join(' > ')}`); return; }
    if (seen.has(id)) return;
    seen.add(id);
    const def = trusted.get(id);
    if (!def) { errors.push(`UNTRUSTED_DEFINITION ${id}`); return; }
    for (const dependency of def.dependencies) visit(dependency, [...trail, id]);
  };
  for (const node of graph.nodes) if (!excluded.has(node.nodeId)) visit(fid(node), []);
  return { closure: [...seen].sort(ord), errors };
}

// ---------- three tiers of use: store and lint, sandbox, approved ----------
export type Tier = 'lint' | 'sandbox' | 'approved';
export interface SandboxAuthority { grantedBy: string; expiresAt: string }
export interface ExecutionContext { now: string; sandbox?: SandboxAuthority; authorizeNode?: (nodeId: string) => { authorized: boolean; reasons: string[] } }

/** A candidate graph may be stored and linted with no approvals. Real execution needs the effective lifecycle and use checks for every node. */
export function canExecute(tier: Tier, graph: Graph, ctx: ExecutionContext, trusted?: TrustedDefinitions): { allowed: boolean; reasons: string[] } {
  const check = validateGraph(graph, trusted);
  if (!check.ok) return { allowed: false, reasons: check.errors };
  if (tier === 'lint') return { allowed: true, reasons: [] };
  if (tier === 'sandbox') {
    if (!ctx.sandbox || ctx.sandbox.expiresAt <= ctx.now) return { allowed: false, reasons: ['SANDBOX_AUTHORITY_MISSING_OR_EXPIRED'] };
    return { allowed: true, reasons: [] };
  }
  const reasons: string[] = [];
  const excluded = new Set(graph.exclusions ?? []);
  for (const node of graph.nodes) {
    if (excluded.has(node.nodeId)) continue;
    const verdict = ctx.authorizeNode?.(node.nodeId) ?? { authorized: false, reasons: ['NO_AUTHORIZER'] };
    if (!verdict.authorized) reasons.push(...verdict.reasons.map((reason) => `${node.nodeId}:${reason}`));
  }
  return { allowed: reasons.length === 0, reasons };
}

// ---------- permission: a ceiling, intersected with scope ----------
export type Use = 'DEMO' | 'PLANNING' | 'OPERATIONAL';
const USE_RANK: Record<Use, number> = { DEMO: 1, PLANNING: 2, OPERATIONAL: 3 };
export interface Grant {
  id: string; use: Use; tenants: string[]; resources: string[]; purposes: string[]; jurisdictions: string[]; validity: string[];
  actions: string[]; expiresAt: string | null; revoked: boolean;
}
export interface UseRequest { use: Use; tenant: string; resource: string; purpose: string; jurisdiction: string; validity: string; action?: string; now: string }

const wide = (list: string[], value: string): boolean => list.includes('*') || list.includes(value);

export function effectivePermission(required: string[], grants: Map<string, Grant>, ownGrantId: string, request: UseRequest): { authorized: boolean; ceiling: Use | null; reasons: string[] } {
  const reasons: string[] = [];
  const own = grants.get(ownGrantId);
  if (!own) reasons.push(`MISSING_APPROVAL:${ownGrantId}`);
  const list: Grant[] = [];
  for (const id of required) {
    const grant = grants.get(id);
    if (!grant) { reasons.push(`MISSING_APPROVAL:${id}`); continue; }
    list.push(grant);
  }
  if (own) list.push(own);
  let ceiling: Use | null = null;
  for (const grant of list) {
    if (ceiling === null || USE_RANK[grant.use] < USE_RANK[ceiling]) ceiling = grant.use;
    if (grant.revoked) reasons.push(`REVOKED:${grant.id}`);
    if (grant.expiresAt && grant.expiresAt <= request.now) reasons.push(`EXPIRED:${grant.id}`);
    if (!wide(grant.tenants, request.tenant)) reasons.push(`TENANT_OUT_OF_SCOPE:${grant.id}`);
    if (!wide(grant.resources, request.resource)) reasons.push(`RESOURCE_OUT_OF_SCOPE:${grant.id}`);
    if (!wide(grant.purposes, request.purpose)) reasons.push(`PURPOSE_OUT_OF_SCOPE:${grant.id}`);
    if (!wide(grant.jurisdictions, request.jurisdiction)) reasons.push(`JURISDICTION_OUT_OF_SCOPE:${grant.id}`);
    if (!wide(grant.validity, request.validity)) reasons.push(`VALIDITY_DOMAIN_OUT_OF_SCOPE:${grant.id}`);
    if (request.action !== undefined && !grant.actions.includes(request.action)) reasons.push(`ACTION_NOT_PERMITTED:${grant.id}`);   // an OPERATIONAL label grants no action
  }
  if (ceiling !== null && USE_RANK[request.use] > USE_RANK[ceiling]) reasons.push(`USE_ABOVE_CEILING_${ceiling}`);
  return { authorized: reasons.length === 0, ceiling, reasons: [...new Set(reasons)].sort(ord) };
}

// ---------- composition envelope and hash ----------
export const COMPOSITION_HASH_DOMAIN = 'AEG-COMP-v1';   // additive; no historical hash domain is changed
/**
 * The identity of a composition covers everything that can change what it may do: the nodes, the typed edges, the external bindings, the
 * predeclared exclusion policy and the RESOLVED dependency closure with its definition hashes (from the trusted registry). Ordering is ordinal.
 */
export function compositionEnvelope(graph: Graph, numericPolicyId: string, units: Record<string, string>, trusted: TrustedDefinitions): Record<string, unknown> {
  const { closure, errors } = dependencyClosure(graph, trusted);
  if (errors.length > 0) throw new Error(errors.join('; '));
  mustBeId(numericPolicyId, 'numericPolicy');
  return {
    schema: 'AEG-COMP-1', numericPolicy: numericPolicyId, graphId: graph.graphId, units,
    nodes: [...graph.nodes].sort((a, b) => ord(a.nodeId, b.nodeId)).map((node) => ({
      nodeId: node.nodeId, formulationId: node.formulationId, version: node.version, definitionHash: node.definitionHash, implementationHash: node.implementationHash,
    })),
    edges: [...graph.edges].sort((a, b) => ord(`${a.from}.${a.output}>${a.to}.${a.input}`, `${b.from}.${b.output}>${b.to}.${b.input}`)).map((edge) => ({
      from: edge.from, output: edge.output, to: edge.to, input: edge.input, dimension: edge.dimension,
    })),
    bindings: [...(graph.bindings ?? [])].sort((a, b) => ord(`${a.nodeId}.${a.input}`, `${b.nodeId}.${b.input}`)).map((b) => ({ nodeId: b.nodeId, input: b.input, source: b.source, dimension: b.dimension, ref: b.ref })),
    exclusions: [...(graph.exclusions ?? [])].sort(ord),
    closure: closure.map((id) => ({ id, definitionHash: (trusted.get(id) as TrustedDefinition).definitionHash })),
  };
}
export const compositionHash = (graph: Graph, numericPolicyId: string, units: Record<string, string>, trusted: TrustedDefinitions): string =>
  hashWithDomain(COMPOSITION_HASH_DOMAIN, compositionEnvelope(graph, numericPolicyId, units, trusted));
