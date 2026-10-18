import type { CardField, CardState, ProviderNoticeCode } from '../../src/types/domain.js';

export type DisplayCardState = CardState | 'awaiting-input';

const STATUS_LABELS: Record<DisplayCardState, string> = {
  draft: '… Draft',
  validated: '✓ Validated',
  reviewed: '✓✓ Reviewed',
  superseded: '↪ Superseded',
  'awaiting-input': '⚠ Awaiting input',
};

const FLAG_LABELS: Record<string, string> = {
  STALE: 'This evidence is older than its validity period.',
  SUPERSEDED: 'A newer evidence revision is available.',
  CONFLICTING: 'Sources contain conflicting values; compare them side by side.',
  COORD_INVALID: 'The source coordinates could not be validated.',
  SYNTHETIC: 'This record is synthetic demonstration data.',
};

const NOTICE_LABELS: Record<ProviderNoticeCode, string> = {
  GOOGLE_UNAVAILABLE_BACKUP_USED: 'Primary model unavailable; a backup model answered.',
  MODELS_UNAVAILABLE: 'Models are unavailable. Showing the calculated result only.',
  MODELS_DISABLED: 'Models are turned off. Use a command such as: help.',
  BUDGET_EXHAUSTED: 'Model budget is used up. Showing the calculated result only.',
  REFUSED: 'The model declined this request.',
  CANCELLED: 'Cancelled. No system action was taken.',
};

export function statusLabel(state: DisplayCardState): string {
  return STATUS_LABELS[state];
}

export function flagExplanation(flag: string): string {
  return FLAG_LABELS[flag] ?? `Evidence flag: ${flag}`;
}

export function noticeText(code: ProviderNoticeCode): string {
  return NOTICE_LABELS[code];
}

export function fieldDisplayValue(value: string | number | null): string {
  return value === null ? 'Unknown' : String(value);
}

/** A card field as the card prints it: the value (or Unknown) plus its unit when there is a value. The 3D view uses this too. */
export function fieldText(field: Pick<CardField, 'value' | 'unit'>): string {
  return `${fieldDisplayValue(field.value)}${field.value !== null && field.unit ? ` ${field.unit}` : ''}`;
}
