import { describe, expect, it } from 'vitest';
import { clusterByGrid, mercatorPixel, NO_CLUSTER_ZOOM } from '../../ui/src/dashboard/cluster.js';

const pts = [
  { id: 'a', lat: 14.60, lng: 121.00 },    // Manila area: three pins within a few km
  { id: 'b', lat: 14.62, lng: 121.03 },
  { id: 'c', lat: 14.58, lng: 120.98 },
  { id: 'd', lat: -6.20, lng: 106.85 },     // Jakarta
  { id: 'e', lat: 5.97, lng: 116.07 },      // Kota Kinabalu
];

describe('map pin clustering', () => {
  it('projects the equator and the antimeridian the way Web Mercator does', () => {
    expect(mercatorPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(mercatorPixel(0, -180, 0).x).toBe(0);
    expect(mercatorPixel(0, 180, 1).x).toBe(512);
  });

  it('merges nearby pins at a low zoom and keeps far pins apart', () => {
    const clusters = clusterByGrid(pts, 5);
    const manila = clusters.find((c) => c.ids.includes('a'))!;
    expect(manila.ids.sort()).toEqual(['a', 'b', 'c']);
    expect(clusters.find((c) => c.ids.includes('d'))!.ids).toEqual(['d']);
    expect(clusters.find((c) => c.ids.includes('e'))!.ids).toEqual(['e']);
    expect(manila.lat).toBeCloseTo(14.6, 1);
  });

  it('splits clusters as the map zooms in, and never clusters at street zoom', () => {
    const counts = [4, 6, 8, 10].map((z) => clusterByGrid(pts, z).length);
    expect([...counts].sort((x, y) => x - y)).toEqual(counts);      // more clusters as zoom grows
    expect(clusterByGrid(pts, 9).length).toBeGreaterThan(clusterByGrid(pts, 4).length - 1);
    expect(clusterByGrid(pts, NO_CLUSTER_ZOOM).length).toBe(pts.length);
  });

  it('keeps the selected pin single even inside a dense group', () => {
    const clusters = clusterByGrid(pts, 5, 56, new Set(['b']));
    expect(clusters.find((c) => c.ids.includes('b'))!.ids).toEqual(['b']);
    expect(clusters.find((c) => c.ids.includes('a'))!.ids.sort()).toEqual(['a', 'c']);
  });

  it('every input appears in exactly one cluster', () => {
    for (const zoom of [3, 4, 5, 7, 10]) {
      const all = clusterByGrid(pts, zoom).flatMap((c) => c.ids).sort();
      expect(all).toEqual(['a', 'b', 'c', 'd', 'e']);
    }
  });

  it('is deterministic', () => {
    expect(clusterByGrid(pts, 5)).toEqual(clusterByGrid([...pts].reverse(), 5));
  });
});
