/** Pure helpers for matching Google's place to the OpenStreetMap place and reading its opening hours (AEG-PLACES-001). No Google types here, so the root type check and unit tests can load it. */
export const MATCH_RADIUS_M = 150;
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180; const dLa = (bLat - aLat) * rad; const dLo = (bLng - aLng) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** The result nearest to the point, if it is within `maxM` metres; a result far away is a different place with a similar name. */
export function pickNearest<T extends { lat: number; lng: number }>(items: T[], point: { lat: number; lng: number }, maxM: number = MATCH_RADIUS_M): T | null {
  let best: T | null = null; let bestD = Infinity;
  for (const it of items) { const d = distanceM(point.lat, point.lng, it.lat, it.lng); if (d <= maxM && d < bestD) { best = it; bestD = d; } }
  return best;
}

/** Today's line from Google's seven weekday descriptions ("Monday: 7:00 AM – 10:00 PM"), for the weekday in Kuala Lumpur (the same clock in Singapore and Brunei). */
export function todayLine(weekday: readonly string[] | undefined | null, now: Date = new Date()): string | null {
  if (!weekday?.length) return null;
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kuala_Lumpur' }).format(now);
  const line = weekday.find((l) => l.toLowerCase().startsWith(`${day.toLowerCase()}:`));
  return line ? `Today: ${line.slice(line.indexOf(':') + 1).trim()}` : null;
}
