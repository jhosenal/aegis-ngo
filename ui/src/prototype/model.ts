import { SEVERITY_ORDER, type HazardEvent, type HazardMap, type HazardType, type SeverityT } from '../../../src/prototype/hazard-map.js';

export type HazardFilter = 'all' | HazardType;

export interface LayerEvent extends HazardEvent {
  hoursAgo: number;
}

export interface LayerModel {
  filter: HazardFilter;
  generatedAt: string;
  events: LayerEvent[];
}

export const BLINK_HZ = 0.8;
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function blinkOpacity(seconds: number, paused = false, reducedMotion = false): number {
  if (paused || reducedMotion) return 1;
  return 0.675 + 0.325 * Math.sin(2 * Math.PI * BLINK_HZ * seconds - Math.PI / 2);
}

export function projectEvents(map: HazardMap, filter: HazardFilter): LayerModel {
  const generated = Date.parse(map.generatedAt);
  const events = map.events
    .filter((event) => filter === 'all' || event.type === filter)
    .map((event) => ({ ...event, hoursAgo: Math.max(0, Math.floor((generated - Date.parse(event.startedAt)) / 3_600_000)) }))
    .sort((left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity] || left.id.localeCompare(right.id));
  return { filter, generatedAt: map.generatedAt, events };
}

export function describeModel(model: LayerModel): string[] {
  return model.events.map((event) => `${event.label} | ${event.type} | ${event.severity} | ${event.hoursAgo} hours ago | ${event.note}`);
}

export function severityToken(severity: SeverityT): string {
  if (severity === 'CRITICAL') return '--aeg-band-unhealthy';
  if (severity === 'WARNING') return '--aeg-band-sensitive';
  return '--aeg-band-moderate';
}
