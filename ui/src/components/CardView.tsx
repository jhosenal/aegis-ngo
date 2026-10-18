import { useEffect, useState, type ReactNode } from 'react';
import type { CardRevision, EvidenceView } from '../../../src/types/domain.js';
import { fieldDisplayValue, fieldText } from '../format.js';
import { EpistemicTag } from './EpistemicTag.js';
import { EvidencePanel, type Citation } from './EvidencePanel.js';
import { StatusBadge } from './StatusBadge.js';
import { SyntheticBanner } from './SyntheticBanner.js';
import { CardActionIcon } from './CardActionIcon.js';
import { SourceCredit } from './SourceCredit.js';
import { HazardArtwork } from './HazardArtwork.js';
import { IncidentPhotoGallery, type IncidentPhoto } from './IncidentPhotoGallery.js';

function citationOf(card: CardRevision): Citation | null {
  const text = (key: string): string | null => { const value = card.body.fields.find((f) => f.key === key)?.value; return typeof value === 'string' && value ? value : null; };
  const source = text('source');
  return source ? { source, url: text('sourcePage'), reportId: card.evidenceIds[0] ?? null, date: text('eventTime')?.slice(0, 10) ?? null } : null;
}

interface CardViewProps {
  card: CardRevision;
  revisions: CardRevision[];
  evidence: EvidenceView[];
  latestRevision: number;
  pinned: boolean;
  attached: boolean;
  onPin: () => void;
  onAttach: (revision: number) => void;
  incidentPhotos?: readonly IncidentPhoto[];
  footer?: ReactNode;
  feedback?: ReactNode;
}

export function CardView({ card, revisions, evidence, latestRevision, pinned, attached, onPin, onAttach, footer, feedback, incidentPhotos=[] }: CardViewProps) {
  const [selectedRevision, setSelectedRevision] = useState(card.revision);
  useEffect(() => setSelectedRevision(card.revision), [card.cardId, card.revision]);
  const status = card.body.status === 'awaiting-input' ? 'awaiting-input' : card.state;
  const actions = <div className="card-actions">
    <label className="card-revision-control">Revision <select data-testid="revision-select" value={selectedRevision} onChange={(event) => setSelectedRevision(Number(event.currentTarget.value))}>
      {revisions.map((revision) => <option key={revision.revision} value={revision.revision}>{revision.revision}</option>)}
    </select></label>
    <button className="ui-button card-action-button" data-testid="pin-toggle" title="Does not share content with models" aria-pressed={pinned} onClick={onPin}><CardActionIcon kind="pin"/>{pinned ? 'Unpin' : 'Pin'}</button>
    <button className="ui-button card-action-button" data-testid="attach-toggle" aria-pressed={attached} onClick={() => onAttach(selectedRevision)}><CardActionIcon kind="attach"/>{attached ? 'Remove from chat' : 'Attach to chat'}</button>
    {latestRevision > card.revision && <span>Newer revision r{latestRevision} available</span>}
  </div>;
  return (
    <>
    <article className="card-view" data-testid={`card-view-${card.cardId}`}>
      <header className="card-header"><div><h2>{card.title}</h2><StatusBadge state={status} /></div><span>Revision {card.revision}</span></header>
      {card.body.synthetic && <SyntheticBanner label={card.body.syntheticLabel} />}
      <p>{card.body.summary}</p>
      {!card.body.synthetic && card.body.fields.some(f => f.key === 'hazardType' && String(f.value).toLowerCase() === 'storm') && evidence.some(e => e.licenceRef === 'LIC.GDACS-CC-BY-4.0-INDICATIVE-ONLY') && <p className="storm-position-note">Storm position (GDACS). This pin marks the storm location, not an impact location.</p>}
      <SourceCredit evidence={evidence}/>
      {card.body.fields.length > 0 && <dl className="card-fields">{card.body.fields.map((field) => (
        <div className="card-field" key={field.key} data-testid={`field-${field.key}`}>
          <dt>{field.label}</dt><dd><span>{field.key === 'country' && field.value === null ? 'Offshore / unspecified' : fieldText(field)}</span><EpistemicTag value={field.epistemic} testId={`epistemic-${field.key}`} /></dd>
        </div>
      ))}</dl>}
      {card.body.sections.map((section) => <details key={section.title} open={!section.collapsedByDefault}>
        <summary>{section.title}</summary>
        <dl>{section.fields.map((field) => <div key={field.key} data-testid={`field-${field.key}`}><dt>{field.label}</dt><dd>{fieldDisplayValue(field.value)} <EpistemicTag value={field.epistemic} testId={`epistemic-${field.key}`} /></dd></div>)}</dl>
      </details>)}
      {card.body.assumptions.length > 0 && <details><summary>Assumptions</summary><ul>{card.body.assumptions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></details>}
      {card.body.warnings.length > 0 && <ul className="card-warnings">{card.body.warnings.map((warning) => <li key={warning.code}>{warning.code}: {warning.message}</li>)}</ul>}
      {card.body.missing.length > 0 && <p>Missing information: {card.body.missing.join(', ')}</p>}
      {card.kind === 'incident' && (incidentPhotos.length ? <IncidentPhotoGallery photos={incidentPhotos}/> : <section className="incident-illustration" aria-label="Hazard illustration" data-card-kind="section" data-card-id="incident:illustration"><h3>Hazard illustration</h3><HazardArtwork hazard={String(card.body.fields.find((field) => field.key === 'hazardType')?.value ?? 'unknown')} className="hazard-detail-art"/><p>Illustrative artwork, not a photograph of this incident.</p></section>)}
      <EvidencePanel evidence={evidence} citation={citationOf(card)} />
      {!footer && actions}
    </article>
    {footer && <footer className="card-dialog-footer card-dialog-footer-actions">{feedback && <div className="card-dialog-feedback">{feedback}</div>}{actions}<div className="card-footer-next">{footer}</div></footer>}
    </>
  );
}
