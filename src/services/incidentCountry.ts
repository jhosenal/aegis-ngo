// ASEAN country of an incident card (AEG-HOME-002), derived at READ time from the card's own regionId field, exactly like incidentPeriod:
// nothing is stored, re-hashed or rewritten, so cards projected before this field existed get it too. A region that names no ASEAN state
// (a sea, an ocean basin) yields a field with value null and epistemic "unknown"; the country is never guessed.
import { aseanCountryOfRegion } from '../domains/asean.js';
import type { CardField, CardRevision } from '../types/domain.js';

export function withCountry(card: CardRevision): CardRevision {
  if (card.kind !== 'incident') return card;
  if (card.body.fields.some((field) => field.key === 'country')) return card;
  const region = card.body.fields.find((field) => field.key === 'regionId')?.value;
  const country = aseanCountryOfRegion(typeof region === 'string' ? region : null);
  const field: CardField = { key: 'country', label: 'ASEAN country', value: country?.name ?? null, unit: null, epistemic: country ? 'calculation' : 'unknown' };
  return { ...card, body: { ...card.body, fields: [...card.body.fields, field] } };
}
