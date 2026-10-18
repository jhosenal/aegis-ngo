// Basemap health (AEG-ENG-012 phase 0): the Google SDK can load and still fail to draw its map (the tile requests are blocked or fail). A few failed tile images are normal; many in a short time mean the
// basemap is not usable, and the page then falls back to the schematic map instead of showing a grey grid. Only Google TILE requests count: a broken marker or place photo must never switch the basemap.
const TILE_HOST = /(^|\.)(googleapis|gstatic|google)\.com$/i;
const TILE_PATH = /(^|\/)(vt|kh)(\/|$)/i;

/** True for the image URLs Google uses for map tiles (road and satellite), false for anything else. */
export function isGoogleTile(src: string): boolean {
  try { const u = new URL(src); return TILE_HOST.test(u.hostname) && TILE_PATH.test(u.pathname); } catch { return false; }
}

/** Counts failures inside a sliding window. `record` returns true when the limit is reached: the basemap has failed. */
export class TileFailureWindow {
  private stamps: number[] = [];
  constructor(private readonly limit = 6, private readonly windowMs = 10_000) {}
  record(now: number): boolean {
    this.stamps = this.stamps.filter((t) => now - t <= this.windowMs); this.stamps.push(now);
    return this.stamps.length >= this.limit;
  }
  reset(): void { this.stamps = []; }
}
