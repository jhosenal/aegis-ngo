import { describe, expect, it } from 'vitest';
import { isGoogleTile, TileFailureWindow } from '../../ui/src/dashboard/mapHealth.js';

describe('basemap health (AEG-ENG-012 phase 0)', () => {
  it('counts only Google tile images, never a marker or a place photo', () => {
    expect(isGoogleTile('https://maps.googleapis.com/maps/vt?pb=!1m5')).toBe(true);
    expect(isGoogleTile('https://khms0.googleapis.com/kh?v=1000&x=1&y=2&z=3')).toBe(true);
    expect(isGoogleTile('https://mt1.google.com/vt/lyrs=m&x=1')).toBe(true);
    expect(isGoogleTile('https://maps.gstatic.com/mapfiles/marker.png')).toBe(false);
    expect(isGoogleTile('/media/hazard-panorama.webp')).toBe(false);
    expect(isGoogleTile('https://upload.wikimedia.org/vt/photo.jpg')).toBe(false);
    expect(isGoogleTile('not a url')).toBe(false);
  });
  it('a few misses are normal; many inside the window mean the basemap failed; old misses expire', () => {
    const w = new TileFailureWindow(6, 10_000);
    for (let i = 0; i < 5; i += 1) expect(w.record(1_000 + i * 100)).toBe(false);
    expect(w.record(1_600)).toBe(true);                           // the sixth within ten seconds
    const slow = new TileFailureWindow(6, 10_000);
    for (let i = 0; i < 20; i += 1) expect(slow.record(i * 5_000)).toBe(false);   // one every five seconds never reaches six in ten seconds
    w.reset(); expect(w.record(50_000)).toBe(false);
  });
});
