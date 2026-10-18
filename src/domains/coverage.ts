// Coarse coverage check for custom pins: Singapore, Brunei and Malaysia only (the pilot area). Rough bounding boxes, not borders: a point just across a border can pass.
export type CoverageCountry = 'SG' | 'BN' | 'MY';
interface Box { south: number; west: number; north: number; east: number }
const SG: Box = { south: 1.15, west: 103.6, north: 1.48, east: 104.1 };
const BN: Box[] = [{ south: 4.0, west: 114.05, north: 5.1, east: 115.4 }];
const MY: Box[] = [{ south: 0.8, west: 99.6, north: 7.4, east: 104.6 }, { south: 0.8, west: 109.5, north: 7.4, east: 119.4 }];
const inside = (b: Box, lat: number, lng: number): boolean => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
/** Order matters: Singapore first (it sits inside the Malaysian peninsula box), then Brunei (it sits inside the Sarawak and Sabah box), then Malaysia. */
export function coverageOf(lat: number, lng: number): CoverageCountry | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (inside(SG, lat, lng)) return 'SG';
  if (BN.some((b) => inside(b, lat, lng))) return 'BN';
  if (MY.some((b) => inside(b, lat, lng))) return 'MY';
  return null;
}
