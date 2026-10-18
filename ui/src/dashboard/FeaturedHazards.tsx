import catalogue from '../../../content/domains/catalogue.json';
import { HazardIcon, hazardSymbol } from '../components/HazardIcon.js';
import type { CardViewData } from '../state/store.js';
import { field } from './data.js';
import { useEffect, useState } from 'react';
import { loadSummary, type HazardSummary } from './history.js';

/** Public domain guides, separate from current incident records and summary metrics. */
export function FeaturedHazards({ incidents, demo, pending, activeHazard, onOpen }: { incidents: CardViewData[]; demo: boolean; pending: boolean; activeHazard: string | null; onOpen: (hazard: string) => void }) {
  const [summary, setSummary] = useState<HazardSummary | null>(null);
  useEffect(() => { let live = true; loadSummary().then((value) => { if (live) setSummary(value); }).catch(() => undefined); return () => { live = false; }; }, []);
  const crops = ['65 421 199 232', '294 421 196 232', '523 421 189 232', '744 421 189 232', '964 421 188 232', '1185 421 190 232', '1407 421 201 232'];
  return <section className="featured-hazards" aria-label="Explore seven hazard domains" data-card-kind="section" data-card-id="section:featured-hazards">
    <header><div className="featured-hazards-heading"><h2>Explore the seven hazards</h2><span aria-hidden="true">|</span><p>Select a card to view its incidents and source review.</p></div><a href="/domains">Domain guides <span aria-hidden="true">→</span></a></header>
    <div className="featured-hazard-grid">{catalogue.domains.map(domain => {
      const symbol = hazardSymbol(domain.name);
      const matching = incidents.filter(item => hazardSymbol(String(field(item.card, 'hazardType') ?? '')) === symbol);
      const unknown = matching.some(item => !['current', 'historical'].includes(String(field(item.card, 'incidentPeriod'))));
      const fromSummary = summary?.domains.find((entry) => entry.number === domain.number) ?? null;
      const local = pending || unknown ? null : matching.filter(item => field(item.card, 'incidentPeriod') === 'current').length;
      // The page's own classification wins (demo cards, workspace cards). Where it is unknown the public evidence-store count is shown instead of a dash.
      // SOL's classification rules stand: an unknown period stays a dash. The public count is used only when the page holds no incident cards at all.
      const count = local ?? (incidents.length === 0 && !pending && fromSummary ? fromSummary.activeCount : null);
      const countLabel = count === null ? 'Current incident count awaiting backend classification'
        : local !== null ? `${count} current ${demo ? 'synthetic demo ' : 'workspace '}incidents`
        : `${count} current incidents held in the Aegis public evidence store${fromSummary?.activeIsSynthetic ? ' (synthetic demo data)' : ''}`;
      return <button type="button" key={domain.number} onClick={() => onOpen(symbol)} className={`featured-hazard-card hazard-theme-${symbol}${activeHazard === symbol ? ' is-active' : ''}`} aria-label={`Show ${domain.name} incidents`} aria-pressed={activeHazard === symbol} data-card-kind="module" data-card-id={`domain:${symbol}`}>
        <svg className="featured-hazard-image" viewBox={crops[domain.number - 1]} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><image href="/brand/hazard-risk-panorama.webp" width="1672" height="941"/></svg>
        <span className="featured-hazard-title"><HazardIcon hazard={domain.name} size={32}/><strong>{domain.name}</strong></span>
        <span className="featured-hazard-count" aria-label={countLabel} title={countLabel}>{count ?? '—'}</span>
        <span className="featured-hazard-link">View details <span aria-hidden="true">↗</span></span>
      </button>;
    })}</div>
  </section>;
}
