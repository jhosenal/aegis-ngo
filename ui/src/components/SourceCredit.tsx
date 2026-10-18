import type { EvidenceView } from '../../../src/types/domain.js';

export function sourceCredit(item: EvidenceView): string {
  if (item.licenceRef === 'LIC.USGS-PUBLIC-DOMAIN-CREDIT-USGS') return 'Source: USGS · Public domain';
  if (item.licenceRef === 'LIC.GDACS-CC-BY-4.0-INDICATIVE-ONLY') return 'Source: GDACS, CC BY 4.0. Indicative only; not for decision making without alternate sources.';
  return `Source: ${item.sourceId} · ${item.licenceRef}`;
}

export function SourceCredit({ evidence }: { evidence: EvidenceView[] }) {
  return <>{evidence.filter(item => !item.synthetic).map(item => <p className="live-source-credit" key={item.evidenceId}>
    {sourceCredit(item)}{' '}{item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Open source</a>}
    <small>Published: {item.publishedAt ?? 'Unknown'} · Retrieved: {item.fetchedAt}</small>
  </p>)}</>;
}
