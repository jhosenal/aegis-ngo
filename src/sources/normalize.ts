import { AegisError } from '../engine/errors.js';
import type { IncidentPayload, IntakeFlag } from '../types/domain.js';

export interface RawIncidentRecord {
  sourceRecordId: string;
  incidentKey: string;
  title: string;
  hazardType: string;
  alertLevel: string;
  eventTime: string;
  publishedAt: string;
  regionId: string;
  lat: string;
  lon: string;
  /** null when the source states none (live feeds); fixtures always give a number. */
  affectedPeopleEstimate: number | null;
  sourceUrl: string;
}

export interface NormalizeSource {
  sourceId: string;
  licenceRef: string;
  validHours: number;
  adapterVersion: string;
  /** Defaults to true (the demo fixtures). A live feed sets false: its records are not demo data. */
  synthetic?: boolean;
}

const COORDINATE_RE = /^(-?)(\d{1,3})(?:\.(\d{1,6}))?$/;
type RequiredStringField = Exclude<keyof RawIncidentRecord, 'affectedPeopleEstimate'>;
const REQUIRED_STRINGS: RequiredStringField[] = [
  'sourceRecordId', 'incidentKey', 'title', 'hazardType', 'alertLevel', 'eventTime', 'publishedAt', 'regionId', 'lat', 'lon', 'sourceUrl',
];

export function parseCoordinate(value: string, kind: 'lat' | 'lon'): number | null {
  const match = COORDINATE_RE.exec(value);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? '').padEnd(6, '0'));
  const microDegrees = sign * (whole * 1_000_000 + fraction);
  const limit = kind === 'lat' ? 90_000_000 : 180_000_000;
  return Math.abs(microDegrees) <= limit ? microDegrees : null;
}

export function normalizeIncident(
  raw: RawIncidentRecord,
  source: NormalizeSource,
  fetchedAt: string,
): { payload: IncidentPayload; intakeFlags: IntakeFlag[]; validUntil: string } {
  if (!Number.isSafeInteger(source.validHours) || source.validHours < 0) {
    throw new AegisError('E_VALIDATION', 'Source validHours must be a nonnegative integer');
  }
  const publishedTime = Date.parse(raw.publishedAt);
  if (!Number.isFinite(publishedTime) || !raw.publishedAt.endsWith('Z')) {
    throw new AegisError('E_VALIDATION', 'publishedAt must be a valid UTC timestamp');
  }

  const flags: IntakeFlag[] = source.synthetic === false ? [] : ['SYNTHETIC'];
  if (REQUIRED_STRINGS.some((field) => raw[field].trim().length === 0)
    || (raw.affectedPeopleEstimate !== null && (!Number.isSafeInteger(raw.affectedPeopleEstimate) || raw.affectedPeopleEstimate < 0))) {
    flags.push('INCOMPLETE');
  }

  const latitude = parseCoordinate(raw.lat, 'lat');
  const longitude = parseCoordinate(raw.lon, 'lon');
  const coordinatesValid = latitude !== null && longitude !== null;
  if (!coordinatesValid) flags.push('COORD_INVALID');

  const payload: IncidentPayload = {
    incidentKey: raw.incidentKey,
    title: raw.title,
    hazardType: raw.hazardType,
    alertLevel: raw.alertLevel,
    regionId: raw.regionId,
    latE6: coordinatesValid ? latitude : null,
    lonE6: coordinatesValid ? longitude : null,
    affectedPeopleEstimate: raw.affectedPeopleEstimate !== null && Number.isSafeInteger(raw.affectedPeopleEstimate) && raw.affectedPeopleEstimate >= 0
      ? raw.affectedPeopleEstimate
      : null,
  };
  const validUntilDate = new Date(publishedTime + source.validHours * 60 * 60 * 1000);
  if (Number.isNaN(validUntilDate.getTime())) throw new AegisError('E_VALIDATION', 'validUntil is outside the supported date range');
  const validUntil = validUntilDate.toISOString().replace(/\.000Z$/, 'Z');
  if (!fetchedAt.endsWith('Z') || !Number.isFinite(Date.parse(fetchedAt))) {
    throw new AegisError('E_VALIDATION', 'fetchedAt must be a valid UTC timestamp');
  }
  return { payload, intakeFlags: flags, validUntil };
}
