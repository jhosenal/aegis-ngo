export const AIR_WEATHER_ICON_PATH = 'M6 13a3.5 3.5 0 1 1 1-6.8 5 5 0 0 1 9.6.8H18a3 3 0 0 1 0 6 M3 17h12a2 2 0 1 0-2-2 M5 21h12a2 2 0 1 0-2-2';
const paths: Record<string, string> = {
  include: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M7 12l3 3 7-7',
  person: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M5 21v-2a7 7 0 0 1 14 0v2',
  personOff: 'M12 3a4 4 0 0 1 3.5 6 M8.5 5a4 4 0 0 0 5.5 5.5 M5 21v-2a7 7 0 0 1 10-6 M19 21v-2 M3 3l18 18',
  volume: 'M3 9h4l5-5v16l-5-5H3z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14',
  muted: 'M3 9h4l5-5v16l-5-5H3z M16 9l6 6 M16 15l6-6',
  weather: AIR_WEATHER_ICON_PATH,
  leaf: 'M20 3C9 2 3 6 4 14c1 7 10 8 14 1 2-3 2-7 2-12Z M4 21 15 9 M9 15l-1-5',
  cloud: 'M6 18a4 4 0 1 1 0-8c.5 0 1 .1 1.4.3a5.5 5.5 0 0 1 10.5 0A4 4 0 1 1 18 18Z',
  expand: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
  alert: 'M12 3L2 21h20z M12 9v5 M12 17v1',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 5 9-5 M12 12v9 M7 5l9 5',
  layers: 'M3 7l9-4 9 4-9 4z M3 12l9 4 9-4 M3 17l9 4 9-4',
  people: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8 M17 4a4 4 0 010 8 M22 21v-2a4 4 0 00-3-4',
  report: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  search: 'M21 21l-5-5 M18 10a8 8 0 11-16 0 8 8 0 0116 0',
  globe: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  close: 'M6 6l12 12 M6 18L18 6',
  spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1114 0 M14 10a2 2 0 11-4 0 2 2 0 014 0',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0113-3l2 3 M4 16l2 3a8 8 0 0013-3',
  settings: 'M12 8a4 4 0 100 8 4 4 0 000-8 M19 12a7 7 0 11-14 0 7 7 0 0114 0',
  plus: 'M12 5v14 M5 12h14',
  fire: 'M12 2c1 5 6 7 6 12a6 6 0 01-12 0c0-3 2-5 3-7 0 4 2 4 3 6 2-3 1-7 0-11z',
  wave: 'M2 8c4-6 6 6 10 0s6 6 10 0 M2 15c4-6 6 6 10 0s6 6 10 0 M2 21h20',
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.alert}/></svg>;
}
