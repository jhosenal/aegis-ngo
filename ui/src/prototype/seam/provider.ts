// The data seam of the hazard-map prototype (engineer-owned; the UI worker builds on it and does not edit it).
import { useEffect, useState } from 'react';
import stub from '../../../../content/prototype/hazard-map.stub.json';
import { parseHazardMap, type HazardMap, type HazardMapProvider } from '../../../../src/prototype/hazard-map.js';

export const stubProvider: HazardMapProvider = {
  // parsed on every load, so an invalid stub fails loudly instead of drawing wrong areas
  load: async () => parseHazardMap(stub),
};
export const defaultProvider: HazardMapProvider = stubProvider;

export type HazardMapState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: HazardMap };

export function useHazardMap(provider: HazardMapProvider = defaultProvider): HazardMapState {
  const [state, setState] = useState<HazardMapState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    provider.load()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data }); })
      .catch(() => { if (!cancelled) setState({ status: 'error', message: 'The hazard map data could not be loaded.' }); });
    return () => { cancelled = true; };
  }, [provider]);
  return state;
}
