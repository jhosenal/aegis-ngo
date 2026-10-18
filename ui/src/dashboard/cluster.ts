// Grid clustering for map pins (AEG-HIST-002). Pure and dependency-free: pins that would sit within one cell of `cellPx` screen pixels at the
// current zoom are merged into one cluster with a count. The selected pin is always kept single so it stays highlighted.

export interface ClusterInput { id: string; lat: number; lng: number }
export interface Cluster { ids: string[]; lat: number; lng: number }

/** Web-Mercator world pixel for a point at a zoom level (the same projection Google Maps uses, 256 px tiles). */
export function mercatorPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

/** At and above this zoom pins are never clustered: the user is looking at street level and every incident should be visible. */
export const NO_CLUSTER_ZOOM = 11;

export function clusterByGrid(items: ClusterInput[], zoom: number, cellPx = 56, keepSingle: ReadonlySet<string> = new Set()): Cluster[] {
  if (zoom >= NO_CLUSTER_ZOOM) return items.map((i) => ({ ids: [i.id], lat: i.lat, lng: i.lng }));
  const cells = new Map<string, ClusterInput[]>();
  const singles: Cluster[] = [];
  for (const item of items) {
    if (keepSingle.has(item.id)) { singles.push({ ids: [item.id], lat: item.lat, lng: item.lng }); continue; }
    const { x, y } = mercatorPixel(item.lat, item.lng, zoom);
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(item); else cells.set(key, [item]);
  }
  const clusters: Cluster[] = [...singles];
  for (const unsorted of cells.values()) {
    const bucket = [...unsorted].sort((x, y) => x.id.localeCompare(y.id));   // order must not depend on input order
    clusters.push({
      ids: bucket.map((b) => b.id),
      lat: bucket.reduce((sum, b) => sum + b.lat, 0) / bucket.length,
      lng: bucket.reduce((sum, b) => sum + b.lng, 0) / bucket.length,
    });
  }
  return clusters.sort((a, b) => (a.ids[0] ?? '').localeCompare(b.ids[0] ?? ''));
}
