import { useEffect } from 'react';
import { parseCatalogue, type Domain } from '../../src/domains/catalogue.js';
import catalogueJson from '../../content/domains/catalogue.json';
import { HazardIcon, hazardSymbol } from './components/HazardIcon.js';
import { HazardArtwork } from './components/HazardArtwork.js';
import './design/tokens.css';
import './domains.css';

// Public, read-only catalogue of the seven hazard domains. It is deliberately explicit that none of the seven runs in the engine yet:
// a specification is not running code, and the page must never let a reader think otherwise.
const catalogue = parseCatalogue(catalogueJson);

function DomainCard({ domain }: { domain: Domain }) {
  const supported = domain.audit.filter((a) => a.kind === 'supported');
  const heldBack = domain.audit.filter((a) => a.kind === 'held-back');
  return <article data-card-kind="module" data-card-id={`domain:${domain.number}`} id={`domain-${domain.number}`} className={`domain-card hazard-theme-${hazardSymbol(domain.name)}`} aria-labelledby={`domain-title-${domain.number}`} tabIndex={-1}>
    <HazardArtwork hazard={domain.name} className="domain-card-art"/>
    <header>
      <span className="domain-icon"><HazardIcon hazard={domain.name} size={44}/></span>
      <p className="domain-ref">{domain.refId}</p>
      <h2 id={`domain-title-${domain.number}`}>{domain.number}. {domain.name}</h2>
      <p className="domain-hazard">{domain.hazard}</p>
      <p className="domain-status" role="note">
        {domain.runsInEngine ? 'Runs in the engine' : 'Specified; selected claims reviewed. Not running in the engine yet.'}
      </p>
    </header>
    <dl className="domain-facts">
      <div><dt>Data it expects</dt><dd>{domain.inputFeeds}</dd></div>
      <div><dt>It works out</dt><dd>{domain.outputs.join(', ')}</dd></div>
      <div><dt>Highest decision level</dt><dd>{domain.topDecisionLevel}</dd></div>
    </dl>
    <details className="domain-audit">
      <summary>What the source audit found ({domain.auditNote})</summary>
      {supported.length > 0 && <>
        <h3>Supported by a saved source</h3>
        <ul>{supported.map((a) => <li key={a.text}>{a.text}</li>)}</ul>
      </>}
      {heldBack.length > 0 && <>
        <h3>Held back: not used</h3>
        <ul>{heldBack.map((a) => <li key={a.text}>{a.text}</li>)}</ul>
      </>}
      <p className="domain-file">Reference {domain.refId}; audit note {domain.auditNote}.</p>
    </details>
  </article>;
}

export function DomainsRoute() {
  useEffect(() => {
    if (/^#domain-[1-7]$/.test(window.location.hash)) {
      const card = document.getElementById(window.location.hash.slice(1));
      card?.scrollIntoView({ block: 'start' });
      card?.focus({ preventScroll: true });
    }
  }, []);
  return <main className="domains-page" aria-label="Aegis hazard domains">
    <header className="domains-header">
      <p className="domains-eyebrow">One engine, seven hazards</p>
      <h1>Aegis hazard domains</h1>
      <figure className="domains-hero">
        <img src="/brand/hazard-panorama.webp" alt="" width={1672} height={941} />
        <figcaption>Seven hazard domains. Illustrative artwork supplied for the AEGIS design; not photographs or evidence of current incidents.</figcaption>
      </figure>
      <p role="note" className="domains-statement">{catalogue.statement}</p>
    </header>
    <section className="domains-grid" aria-label="The seven hazard domains">
      {catalogue.domains.map((domain) => <DomainCard key={domain.number} domain={domain} />)}
    </section>
    <footer className="domains-footer">
      <p>Status as of {catalogue.asOf}. The wildfire domain is the one the haze pilot connects to; the public haze guidance is on the Assist page.</p>
      <p><a href="/assist">Open Aegis Assist (haze guidance)</a></p>
    </footer>
  </main>;
}
