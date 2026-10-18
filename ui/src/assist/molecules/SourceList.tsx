import type { Card } from '../../../../src/assist/contract.js';
import { Icon } from '../atoms/Icon.js';

export function SourceList({ sources }: { sources: Card['sources'] }) {
  return <details className="assist-sources">
    <summary aria-label="Show card sources"><Icon name="source" /> Source</summary>
    <ul aria-label="Sources for this card">
      {sources.map((source) => <li key={source.sourceId}>
        <strong>{source.publisher}</strong>
        <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
        {source.published && <span>Published {source.published}</span>}
        <span>Accessed {source.accessed}</span>
        <span>Status: {source.status}</span>
        {source.passage && <blockquote>{source.passage}</blockquote>}
      </li>)}
    </ul>
  </details>;
}
