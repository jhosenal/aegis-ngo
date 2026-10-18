// The eleven ASEAN member states and the mapping from a record's regionId to one of them. A regionId that does not name an ASEAN state
// (a sea, an ocean basin, an unknown label) maps to null: the country is then unknown, never guessed.
export interface AseanCountry { iso3: string; name: string }

export const ASEAN_COUNTRIES: readonly AseanCountry[] = [
  { iso3: 'BRN', name: 'Brunei' }, { iso3: 'KHM', name: 'Cambodia' }, { iso3: 'IDN', name: 'Indonesia' }, { iso3: 'LAO', name: 'Laos' },
  { iso3: 'MYS', name: 'Malaysia' }, { iso3: 'MMR', name: 'Myanmar' }, { iso3: 'PHL', name: 'Philippines' }, { iso3: 'SGP', name: 'Singapore' },
  { iso3: 'THA', name: 'Thailand' }, { iso3: 'TLS', name: 'Timor-Leste' }, { iso3: 'VNM', name: 'Viet Nam' },
];

const ALIASES: Record<string, string> = {
  BRUNEI: 'BRN', BRUNEI_DARUSSALAM: 'BRN', CAMBODIA: 'KHM', INDONESIA: 'IDN', LAOS: 'LAO', LAO_PDR: 'LAO', LAO_PEOPLE_S_DEMOCRATIC_REPUBLIC: 'LAO',
  MALAYSIA: 'MYS', MYANMAR: 'MMR', BURMA: 'MMR', BURMA_MYANMAR: 'MMR', PHILIPPINES: 'PHL', SINGAPORE: 'SGP', THAILAND: 'THA',
  TIMOR_LESTE: 'TLS', EAST_TIMOR: 'TLS', VIET_NAM: 'VNM', VIETNAM: 'VNM',
};

export function aseanCountryOfRegion(regionId: string | null | undefined): AseanCountry | null {
  if (!regionId) return null;
  const key = regionId.toUpperCase().replace(/^REGION\./, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const iso3 = ALIASES[key];
  return ASEAN_COUNTRIES.find((c) => c.iso3 === iso3) ?? null;
}
