// Singapore NEA PSI, live (AEG-PSI-001): the 24-hour Pollutant Standards Index by region, from data.gov.sg's real-time API (keyless).
// Licence: Singapore Open Data Licence v1.0 (commercial use allowed; a source notice and a link to the licence are required).
// Bands are NEA's own (saved in content/assist/haze-sg.cards.json from NEA's pages): 0-50 Good, 51-100 Moderate, 101-200 Unhealthy, 201-300 Very Unhealthy, above 300 Hazardous.
import { z } from 'zod';

export const PSI_SOURCE_ID = 'SRC.NEA.PSI.LIVE';
export const PSI_URL = 'https://api-open.data.gov.sg/v2/real-time/api/psi';
export const PSI_ATTRIBUTION = 'Contains information from PSI accessed from data.gov.sg (National Environment Agency, Singapore), made available under the terms of the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).';
export const PSI_REGIONS = ['north', 'south', 'east', 'west', 'central'] as const;
export type PsiRegion = typeof PSI_REGIONS[number];

export type PsiBand = 'Good' | 'Moderate' | 'Unhealthy' | 'Very Unhealthy' | 'Hazardous';
export const PSI_BANDS: readonly { band: PsiBand; from: number; to: number | null }[] = [
  { band: 'Good', from: 0, to: 50 }, { band: 'Moderate', from: 51, to: 100 }, { band: 'Unhealthy', from: 101, to: 200 },
  { band: 'Very Unhealthy', from: 201, to: 300 }, { band: 'Hazardous', from: 301, to: null },
];
export const bandOf = (psi: number): PsiBand => PSI_BANDS.find((b) => b.to === null || psi <= b.to)!.band;

const Regions = z.object({ north: z.number(), south: z.number(), east: z.number(), west: z.number(), central: z.number() });
const Reply = z.object({
  code: z.number().optional(),
  data: z.object({
    items: z.array(z.object({
      timestamp: z.string(), updatedTimestamp: z.string().optional(),
      readings: z.object({ psi_twenty_four_hourly: Regions, pm25_twenty_four_hourly: Regions.optional() }).passthrough(),
    }).passthrough()).min(1),
  }),
});

export interface PsiReading {
  /** The hour the reading is for, as UTC ISO (NEA publishes +08:00). */
  observedAt: string;
  updatedAt: string | null;
  psi: Record<PsiRegion, number>;
  pm25: Record<PsiRegion, number> | null;
}

const utc = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`bad timestamp ${iso}`);
  return new Date(ms).toISOString();
};

/** Parses the real-time reply; throws on any shape it does not recognise (the caller records the poll as malformed and keeps what it had). */
export function parsePsi(raw: unknown): PsiReading {
  const parsed = Reply.parse(raw);
  const item = parsed.data.items[0]!;
  const psi = item.readings.psi_twenty_four_hourly;
  for (const r of PSI_REGIONS) if (!Number.isFinite(psi[r]) || psi[r] < 0 || psi[r] > 1000) throw new Error(`PSI out of range for ${r}`);
  return { observedAt: utc(item.timestamp), updatedAt: item.updatedTimestamp ? utc(item.updatedTimestamp) : null, psi, pm25: item.readings.pm25_twenty_four_hourly ?? null };
}
