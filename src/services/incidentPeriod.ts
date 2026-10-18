// incidentPeriod (AEG-HAZARD-001, owner request C0003): is an incident card current or historical? Computed at READ time from the evidence
// the card cites, never stored, so a card turns historical on its own when its evidence goes stale or is superseded.
// A card that cites no evidence gets no field at all: unknown stays unknown and the UI shows its own "classification pending" state.
import type { CardField, CardRevision, EvidenceView } from '../types/domain.js';

export type IncidentPeriod = 'current' | 'historical';

export function incidentPeriodOf(views: EvidenceView[]): IncidentPeriod | null {
  if (views.length === 0) return null;
  return views.some((view) => view.flags.includes('STALE') || view.flags.includes('SUPERSEDED')) ? 'historical' : 'current';
}

/** A copy of an incident card with a derived `incidentPeriod` field; any other card, or one that already carries the field, is returned unchanged. */
export function withIncidentPeriod(card: CardRevision, views: EvidenceView[]): CardRevision {
  if (card.kind !== 'incident') return card;
  if (card.body.fields.some((field) => field.key === 'incidentPeriod')) return card;
  const period = incidentPeriodOf(views.filter((view) => card.evidenceIds.includes(view.evidenceId)));
  if (period === null) return card;
  const field: CardField = { key: 'incidentPeriod', label: 'Period', value: period, unit: null, epistemic: 'calculation' };
  return { ...card, body: { ...card.body, fields: [...card.body.fields, field] } };
}
