// The seam between the overview screen and its data (engineer-owned; Luna VI builds on it and does not edit it).
// Today the provider is the synthetic stub. When real data exists, an API provider implements the same interface and `currentProvider`
// changes here, with no change to any screen. `?scenario=unknown|empty|error` on /overview serves a stub variant (see scenarios.ts) so the
// designed states for unknown values, empty sections and a failed load can be seen and tested.
import { useEffect, useState } from 'react';
import stub from '../../../../content/overview/stub-haze-incident.json';
import { parseOverview, type Overview, type OverviewProvider } from '../../../../src/overview/contract.js';
import { applyScenario, scenarioFromSearch, SCENARIOS, type Scenario } from './scenarios.js';

// one stable provider object per scenario, so React effects do not reload on every render
const providers: Record<Scenario, OverviewProvider> = Object.fromEntries(SCENARIOS.map((scenario) => [scenario, {
  // parsed on every load, so an invalid stub fails loudly in development and in the tests instead of rendering wrong numbers
  load: async () => applyScenario(parseOverview(stub), scenario),
} satisfies OverviewProvider])) as Record<Scenario, OverviewProvider>;

export const stubProvider: OverviewProvider = providers.default;
export const defaultProvider: OverviewProvider = stubProvider;

/** The provider for the page being shown: the stub, or one of its scenarios chosen by the query string. */
export function currentProvider(): OverviewProvider {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  return providers[scenarioFromSearch(search)];
}

export type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: Overview };

/** Loads the overview. The three states (loading, error, ready) are all designed screens; the error text never contains a stack trace. */
export function useOverview(provider: OverviewProvider = currentProvider()): OverviewState {
  const [state, setState] = useState<OverviewState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    provider.load()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data }); })
      .catch(() => { if (!cancelled) setState({ status: 'error', message: 'The overview data could not be loaded.' }); });
    return () => { cancelled = true; };
  }, [provider]);
  return state;
}
