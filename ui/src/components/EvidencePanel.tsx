import type { EvidenceView } from '../../../src/types/domain.js';
import { SourceCredit } from './SourceCredit.js';
import { flagExplanation } from '../format.js';

/** A source the card names but AEGIS holds no stored copy of (a published report cited by name, link and date). Shown instead of 'No evidence linked'. */
export interface Citation { source: string; url: string | null; reportId: string | null; date: string | null }

export function EvidencePanel({ evidence, citation }: { evidence: EvidenceView[]; citation?: Citation | null }) {
  const conflicts = evidence.filter((item) => item.flags.includes('CONFLICTING'));
  return (
    <section className="evidence-panel" aria-label="Evidence">
      <h3>Evidence</h3>
      {evidence.length === 0 && citation ? <article className="evidence-item" data-testid="cited-source">
        <h4>Cited source (no stored copy)</h4>
        <dl><dt>Source</dt><dd>{citation.source}</dd>
          {citation.reportId && <><dt>Report</dt><dd>{citation.reportId}</dd></>}
          {citation.date && <><dt>Event date</dt><dd>{citation.date}</dd></>}
          {citation.url && <><dt>Link</dt><dd><a href={citation.url} target="_blank" rel="noopener noreferrer">{citation.url}</a></dd></>}
          <dt>Status</dt><dd>Reported by the source and shown as published. AEGIS holds no saved copy or hash of this report and has not verified it. Licence: unverified.</dd></dl>
      </article> : evidence.length === 0 ? <p data-testid="empty-evidence">No evidence linked.</p> : evidence.map((item) => (
        <article className="evidence-item" key={item.evidenceId}>
          <SourceCredit evidence={[item]}/><h4>{item.sourceId} · {item.evidenceId}</h4>
          <div className="evidence-flags">
            {item.flags.map((flag) => <span className="evidence-flag" data-testid={`evidence-flag-${flag}`} key={flag} title={flagExplanation(flag)}>{flag}: {flagExplanation(flag)}</span>)}
          </div>
          <details><summary>Evidence details</summary><dl>
            <dt>Revision</dt><dd>{item.revision}</dd>
            <dt>Published</dt><dd>{item.publishedAt ?? 'Unknown'}</dd>
            <dt>Artifact hash</dt><dd>{item.rawArtifactHash}</dd>
            <dt>Payload hash</dt><dd>{item.normalizedPayloadHash}</dd>
            <dt>Summary</dt><dd>{item.payload.title}</dd>
          </dl></details>
        </article>
      ))}
      {conflicts.length > 1 && <section className="conflict-sources" aria-label="Conflicting sources">
        <h4>Conflicting sources</h4>
        <div className="conflict-columns">{conflicts.map((item) => <article key={item.evidenceId}><strong>{item.sourceId}</strong><p>{item.payload.title}</p><span>{item.evidenceId}</span></article>)}</div>
      </section>}
    </section>
  );
}
