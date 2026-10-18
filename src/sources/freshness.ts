// How fresh a reading is, stated on the card (AEG-ENV-001; owner MVP rule: an open item becomes a visible remark, never a false claim).
// Two kinds of text live here and they are kept apart on purpose:
//   - computed: the age of THIS reading, from the provider's own timestamp and our fetch time (always true);
//   - stated:   what the provider documents about its cadence, with its basis. Owner estimates that no source page confirms are labelled so.
// Nothing here says "real time", "instant" or "verified" unless the basis is a saved publisher statement.

export type FreshnessBasis = 'PUBLISHER_STATED' | 'MEASURED_ONE_SAMPLE' | 'OWNER_ESTIMATE_UNVERIFIED' | 'NOT_PUBLISHED';

export interface FreshnessEntry {
  sourceKey: string;
  /** What the publisher itself says (saved page or doc read), or "not published". */
  stated: string;
  statedBasis: FreshnessBasis;
  /** The owner's rough estimate, kept so it can be confirmed or dropped; never shown as a fact. */
  ownerEstimate: string | null;
  /** Our own measurement, with how many samples it rests on. */
  measured: string | null;
}

export const FRESHNESS_REGISTER: Record<string, FreshnessEntry> = {
  GOOGLE_AIR_QUALITY: {
    sourceKey: 'GOOGLE_AIR_QUALITY',
    stated: 'Hourly data; the timestamp is rounded down to the hour (Google Air Quality reference, read 2026-10-16).',
    statedBasis: 'PUBLISHER_STATED',
    ownerEstimate: '15 to 45 minutes of processing latency after the top of the hour',
    measured: 'One sample on 2026-10-15: fetched 16:32 UTC, newest hour offered 15:00 UTC, 92 minutes old. This is one sample; it does not confirm the 15 to 45 minute estimate.',
  },
  GOOGLE_WEATHER_CURRENT: {
    sourceKey: 'GOOGLE_WEATHER_CURRENT',
    stated: 'Google does not publish how often current conditions refresh.',
    statedBasis: 'NOT_PUBLISHED',
    ownerEstimate: '15-minute refresh',
    measured: 'The response timestamp equals the request time, so it cannot show when the underlying observation was made.',
  },
  GOOGLE_WEATHER_HOURLY: {
    sourceKey: 'GOOGLE_WEATHER_HOURLY',
    stated: 'Hourly forecast starting from the current hour, up to 240 hours (Google Weather reference).',
    statedBasis: 'PUBLISHER_STATED',
    ownerEstimate: null,
    measured: 'One sample: first forecast hour began at the top of the current hour.',
  },
  GOOGLE_WEATHER_ALERTS: {
    sourceKey: 'GOOGLE_WEATHER_ALERTS',
    stated: 'Alerts are served as published by each agency; update frequency and quality depend on the agency and Google does not guarantee timeliness (Google Weather alerts guide).',
    statedBasis: 'PUBLISHER_STATED',
    ownerEstimate: null,
    measured: 'Singapore answers; Malaysia answers "not supported for this location" (one probe each, 2026-10-16).',
  },
  USGS_EARTHQUAKE: {
    sourceKey: 'USGS_EARTHQUAKE',
    stated: 'Real-time GeoJSON summary feeds are "updated every minute" (USGS feed page, read 2026-10-15). The delay from an earthquake to its appearance is not published there.',
    statedBasis: 'PUBLISHER_STATED',
    ownerEstimate: '1 to 5 minutes after the event',
    measured: null,
  },
  NASA_FIRMS: {
    sourceKey: 'NASA_FIRMS',
    stated: 'Real-time data is available within 60 minutes of a satellite overpass; detections come from satellite passes, not continuous watching (NASA FIRMS Area API page, read 2026-10-15).',
    statedBasis: 'PUBLISHER_STATED',
    ownerEstimate: '3 to 4 hours (satellite pass and ground processing), 2 to 4 updates a day',
    measured: null,
  },
  GDACS: {
    sourceKey: 'GDACS',
    stated: 'GDACS does not state a refresh cadence on its feed; items carry publication and modification times.',
    statedBasis: 'NOT_PUBLISHED',
    ownerEstimate: '15 to 30 minutes after an agency alert',
    measured: null,
  },
};

const OWNER_NOTE = 'An unconfirmed owner estimate is not a guarantee.';

export interface FreshnessStatement {
  sourceKey: string;
  /** The provider's own timestamp for the data, or null when it gives none. */
  observedAt: string | null;
  fetchedAt: string;
  /** Minutes between the provider timestamp and our fetch; null when the provider gives no usable timestamp. */
  ageMinutes: number | null;
  /** One plain sentence about THIS reading. */
  text: string;
  /** What is known about the source's cadence, and on what basis. */
  cadence: string;
  cadenceBasis: FreshnessBasis;
}

function minutesBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 60_000));
}

function span(minutes: number): string {
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.round(minutes / 6) / 10} hours`;
}

/** Builds the statement for one reading. `observedAt` is the provider's own timestamp (never our fetch time). */
export function describeFreshness(sourceKey: string, observedAt: string | null, fetchedAt: string, options: { unsupported?: boolean } = {}): FreshnessStatement {
  const entry = FRESHNESS_REGISTER[sourceKey];
  if (!entry) throw new Error(`unknown freshness source ${sourceKey}`);
  const ageMinutes = observedAt === null ? null : minutesBetween(observedAt, fetchedAt);
  let text: string;
  if (options.unsupported) {
    text = 'This provider has no alert source for this place, so "no alert shown" does not mean "no alert".';
  } else if (observedAt === null || ageMinutes === null) {
    text = `The provider gave no data timestamp; this was read at ${fetchedAt}.`;
  } else {
    text = `Data for ${observedAt}, read ${span(ageMinutes)} later at ${fetchedAt}. Aegis refreshes at fixed times, so it may be older when you see it.`;
  }
  const estimate = entry.ownerEstimate ? ` Owner estimate: ${entry.ownerEstimate}. ${OWNER_NOTE}` : '';
  const measured = entry.measured ? ` Measured: ${entry.measured}` : '';
  return {
    sourceKey,
    observedAt,
    fetchedAt,
    ageMinutes,
    text,
    cadence: `${entry.stated}${estimate}${measured}`,
    cadenceBasis: entry.statedBasis,
  };
}
