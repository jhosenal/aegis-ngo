import { AegisError } from '../engine/errors.js';
import type { RouteDef, Role } from '../types/domain.js';

const ALL_ROLES: Role[] = ['coordinator', 'analyst', 'viewer'];
const ASSESSMENT_ROLES: Role[] = ['coordinator', 'analyst'];

export const ROUTES: readonly RouteDef[] = [
  { routeId: 'I_aegis_help_show', title: 'Show help', allowedRoles: [...ALL_ROLES], modelProposable: true, sideEffects: 'none' },
  { routeId: 'I_aegis_incident_list', title: 'List incidents', allowedRoles: [...ALL_ROLES], modelProposable: true, sideEffects: 'none' },
  { routeId: 'I_aegis_card_open', title: 'Open card', allowedRoles: [...ALL_ROLES], modelProposable: true, sideEffects: 'none' },
  { routeId: 'I_aegis_resource_assess', title: 'Assess resources', allowedRoles: [...ASSESSMENT_ROLES], modelProposable: true, sideEffects: 'writes-card' },
  { routeId: 'I_aegis_audit_verify', title: 'Verify audit chain', allowedRoles: ['coordinator'], modelProposable: false, sideEffects: 'none' },
  { routeId: 'I_aegis_card_explain', title: 'Explain card', allowedRoles: [...ALL_ROLES], modelProposable: true, sideEffects: 'none' },
];

export function getRoute(routeId: string): RouteDef {
  const route = ROUTES.find((candidate) => candidate.routeId === routeId);
  if (!route) throw new AegisError('E_ROUTE_DENIED');
  return route;
}
