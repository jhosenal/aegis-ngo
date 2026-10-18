// Camera formula (AEG-NEWS-006): where the map looks while the presenter names countries. Pure functions, no map, no clock; the reader and the map act on the plan.
import type { CameraView } from './newsContent.js';

/**
 * The rules, in seconds. Owner's formula of 2026-10-16 (simplified the same evening to ONE zoom in and ONE zoom out):
 *  - the camera starts moving `leadSec` BEFORE the first country is pronounced, and takes `travelSec` (a smooth, eased move) to the Malaysia frame, which holds Singapore and Brunei too;
 *  - if a plan has several mentions it stays on each until the next one's move starts (at least `minGapSec` after the previous move began, so moves never pile up);
 *  - after the LAST country has been pronounced it waits `returnDelaySec`, then moves back to the default view the same smooth way.
 * If a smooth move is not available (the viewer prefers reduced motion) the map dissolves instead of moving: a short fade to the map colour, the cut, a fade back.
 */
export const CAMERA_RULES = { leadSec: 1.0, travelSec: 1.2, minGapSec: 0.8, returnDelaySec: 2.0 } as const;
export type CameraRules = { readonly [K in keyof typeof CAMERA_RULES]: number };

/** A country named in the narration: `at` is when the word starts, `end` when it has been said (seconds from the start of the narration). */
export interface Mention { view: CameraView; at: number; end: number }
export interface CameraStep { at: number; view: CameraView | 'default'; travelSec: number }

export function planCamera(mentions: readonly Mention[], rules: CameraRules = CAMERA_RULES): CameraStep[] {
  const sorted = [...mentions].sort((a, b) => a.at - b.at);
  const steps: CameraStep[] = [];
  for (const m of sorted) {
    const previous = steps[steps.length - 1];
    const at = Math.max(0, m.at - rules.leadSec, previous ? previous.at + rules.minGapSec : 0);
    steps.push({ at, view: m.view, travelSec: rules.travelSec });
  }
  const last = sorted[sorted.length - 1];
  if (last) steps.push({ at: Math.max(last.end + rules.returnDelaySec, steps[steps.length - 1]!.at + rules.travelSec), view: 'default', travelSec: rules.travelSec });
  return steps;
}

/** The step in force at time `t` (the latest whose start has passed), or null before the first. */
export function stepAt(steps: readonly CameraStep[], t: number): CameraStep | null {
  let active: CameraStep | null = null;
  for (const s of steps) if (s.at <= t) active = s;
  return active;
}

// ---- the camera a view needs, from the map size: pure Mercator arithmetic, so the move can be animated without asking the map to jump ----
const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unMercY = (y: number): number => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
export interface Bounds { south: number; west: number; north: number; east: number }
export interface Pad { top: number; bottom: number; left: number; right: number }

/** Centre and zoom that fit `b` inside the map minus `pad` (the free part), with the bounds centred in that free part. */
export function cameraFor(b: Bounds, width: number, height: number, pad: Pad, minZoom = 3, maxZoom = 14): { lat: number; lng: number; zoom: number } {
  const freeW = Math.max(50, width - pad.left - pad.right); const freeH = Math.max(50, height - pad.top - pad.bottom);
  const zx = Math.log2(freeW / ((Math.max(0.0001, b.east - b.west) / 360) * 256));
  const zy = Math.log2(freeH / ((Math.max(0.0001, mercY(b.north) - mercY(b.south)) / (2 * Math.PI)) * 256));
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(zx, zy)));
  const world = 256 * 2 ** zoom;
  // The bounds centre must land at the middle of the free part: shift the map centre by the difference between the two middles.
  const dx = width / 2 - (pad.left + freeW / 2); const dy = height / 2 - (pad.top + freeH / 2);
  const cx = (b.west + b.east) / 2 + (dx / world) * 360;
  const cy = (mercY(b.north) + mercY(b.south)) / 2 - (dy / world) * 2 * Math.PI;
  return { lat: unMercY(cy), lng: cx, zoom };
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Position at progress `p` (0..1) of a move: eased, with the centre interpolated in Mercator space so the path is straight on screen. */
export function lerpCamera(from: { lat: number; lng: number; zoom: number }, to: { lat: number; lng: number; zoom: number }, p: number): { lat: number; lng: number; zoom: number } {
  const e = easeInOutCubic(Math.max(0, Math.min(1, p)));
  return { lng: from.lng + (to.lng - from.lng) * e, lat: unMercY(mercY(from.lat) + (mercY(to.lat) - mercY(from.lat)) * e), zoom: from.zoom + (to.zoom - from.zoom) * e };
}
