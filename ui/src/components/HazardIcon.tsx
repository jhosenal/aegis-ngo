/** Scalable line symbols redrawn from the owner's seven-hazard reference. */
export const hazardSymbols = ['seismic', 'hydrological', 'meteorological', 'wildfire', 'biological', 'displacement', 'volcanic'] as const;
export type HazardSymbol = typeof hazardSymbols[number] | 'haze' | 'unknown';

export function hazardSymbol(hazard: string): HazardSymbol {
  const value = hazard.trim().toLowerCase();
  if (/earthquake|seismic|tsunami/.test(value)) return 'seismic';
  if (/flood|hydrolog/.test(value)) return 'hydrological';
  if (/storm|rain|cyclone|typhoon|hurricane|meteorolog/.test(value)) return 'meteorological';
  if (/wildfire|forest.?fire|^fire$/.test(value)) return 'wildfire';
  if (/biolog|outbreak|epidemic|pandemic/.test(value)) return 'biological';
  if (/displace|refugee/.test(value)) return 'displacement';
  if (/volcan|eruption/.test(value)) return 'volcanic';
  if (/haze|air.?quality|smoke/.test(value)) return 'haze';
  return 'unknown';
}

export const hazardIconPaths: Record<HazardSymbol, string> = {
  seismic: 'M2 14h5l1.5-3 2 6L13 4l1.5 17L17 11l1.5 3H22',
  hydrological: 'M12 2C10 5 5.5 10.5 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10.5 14 5 12 2Z M15.8 15a4 4 0 0 1-3 3.8',
  meteorological: 'M5.5 14a3.5 3.5 0 0 1 0-7c.5 0 1 .1 1.4.3a5.5 5.5 0 0 1 10.5 0 3.4 3.4 0 1 1 1.1 6.7Z M8 17l-2 4 M12.5 17l-2 4 M17 17l-2 4',
  wildfire: 'M10 22C3 20 3 13 7.5 8l-.3 4C10.5 8.5 12 5 11.5 2c4.5 3.5 5.5 7 4 11l2.5-4c4.5 6 3 11-4 13 2.5-4-.5-5.5-2-8-1 2.5-5 4.5-2 8Z',
  biological: 'M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M13 1.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z M13 22.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z M2.5 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z M23.5 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z M10.5 10a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z M15.5 10.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z M13 15a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  displacement: 'M15.5 6a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z M7.5 22v-6a4.5 4.5 0 0 1 9 0v6Z M5.5 22H2v-6a4 4 0 0 1 4-4 M18.5 22H22v-6a4 4 0 0 0-4-4 M6 9a3 3 0 1 1 0-6 M18 9a3 3 0 1 0 0-6',
  volcanic: 'M2 22 10 9l2-1 4 8 2-5 5 11Z M7 14h2l1.5 3L12 14 M16 13l1 3 M11 4V1 M7 5 5 3 M15 5l2-2',
  haze: 'M3 8h13a3 3 0 1 0-3-3 M2 12h18 M4 16h11a3 3 0 1 1-3 3',
  unknown: 'M12 3 2 21h20Z M12 9v5 M12 17v.5',
};

export function HazardIcon({ hazard, size = 24 }: { hazard: string; size?: number }) {
  const symbol = hazardSymbol(hazard);
  return <svg className="hazard-symbol" data-hazard-symbol={symbol} width={size} height={size}
    viewBox="-1 -1 26 26" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={hazardIconPaths[symbol]}/>
  </svg>;
}
