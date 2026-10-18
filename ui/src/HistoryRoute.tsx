import { HazardHistory } from './dashboard/HazardHistory.js';
import './design/tokens.css';

/** Public page: ten years of ASEAN incidents on a map with a month range, search and sources (contract C0005). */
export function HistoryRoute() {
  const params = new URLSearchParams(window.location.search);
  const raw = Number(params.get('domain'));
  const domain = Number.isInteger(raw) && raw >= 1 && raw <= 7 ? raw : null;
  return <>
    <main className="history-page" style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px 48px' }}>
      <h1>Past incidents in ASEAN, 2016 to now</h1>
      <p>Earthquakes, floods, cyclones, volcanoes, haze episodes and outbreak notices, each with its source, licence and the time we retrieved it. These are past incidents, not current alerts.</p>
      <HazardHistory domain={domain} showDomainChips/>
    </main>
  </>;
}
