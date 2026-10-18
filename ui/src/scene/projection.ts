import type { CardKind, CardRevision, EvidenceView, QualityFlag } from '../../../src/types/domain.js';
import { AegisError } from '../../../src/engine/errors.js';
import { fieldText } from '../format.js';

/**
 * Morphism projection: cards -> scene model -> plain text.
 * The scene is a typed, deterministic projection of cards the user already loaded. It adds no data of its own, it refuses input
 * it cannot represent faithfully (it throws, it never clamps or defaults to zero), and describeModel() renders the same tiles
 * back as text so a test can check that the 3D view and the 2D CardView say the same thing.
 */
export const MAX_TILES = 200;
export const MAX_LABEL_CHARS = 40;

const CARD_KINDS: readonly CardKind[] = ['incident', 'resource', 'assessment', 'evidence', 'note'];

export type SceneQuantity =
  | { kind: 'none' }                                           // the card has no quantity (an incident)
  | { kind: 'unknown'; text: string }                          // the card has a quantity slot and it is null: drawn as an outline, never as zero
  | { kind: 'units'; units: number; text: string };

export interface SceneTile {
  cardId: string;
  kind: 'incident' | 'assessment';
  label: string;
  quantity: SceneQuantity;
  flags: QualityFlag[];
  synthetic: boolean;
}
export interface SceneModel { tiles: SceneTile[]; truncated: boolean; ambient: 'calm' | 'attention' }
export interface ProjectionInput { card: CardRevision; evidence: EvidenceView[] }

const ATTENTION_FLAGS: readonly QualityFlag[] = ['CONFLICTING', 'COORD_INVALID'];

/** Untrusted card text becomes a short plain label. It is only ever drawn as canvas text, never as HTML. */
export function labelOf(title: string): string {
  const chars = Array.from(title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim());
  return chars.length <= MAX_LABEL_CHARS ? chars.join('') : `${chars.slice(0, MAX_LABEL_CHARS - 1).join('')}…`;
}

function fail(message: string): never {
  throw new AegisError('E_VALIDATION', message);
}

function quantityOf(card: CardRevision): SceneQuantity {
  if (card.kind !== 'assessment') return { kind: 'none' };
  const field = card.body.fields.find((item) => item.key === 'shortfallUnits');
  if (!field) return fail(`Assessment card ${card.cardId} has no shortfallUnits field`);
  const text = fieldText(field);
  if (field.value === null) return { kind: 'unknown', text };
  if (typeof field.value !== 'number' || !Number.isInteger(field.value) || field.value < 0) {
    return fail(`Assessment card ${card.cardId} has an invalid shortfall quantity`);
  }
  return { kind: 'units', units: field.value, text };
}

function flagsOf(evidence: EvidenceView[]): QualityFlag[] {
  return [...new Set(evidence.flatMap((item) => item.flags))].sort();
}

export function projectCards(items: ProjectionInput[]): SceneModel {
  const tiles: SceneTile[] = [];
  const seen = new Set<string>();
  for (const { card, evidence } of items) {
    if (typeof card.cardId !== 'string' || card.cardId === '') fail('A card has no cardId');
    if (!CARD_KINDS.includes(card.kind)) fail(`Card ${card.cardId} has an unknown kind`);
    if (card.kind !== 'incident' && card.kind !== 'assessment') continue;   // other kinds are valid but have no tile
    if (seen.has(card.cardId)) fail(`Card ${card.cardId} appears twice`);
    seen.add(card.cardId);
    tiles.push({
      cardId: card.cardId,
      kind: card.kind,
      label: labelOf(card.title),
      quantity: quantityOf(card),
      flags: flagsOf(evidence),
      synthetic: card.body.synthetic,
    });
  }
  tiles.sort((left, right) => (left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0));
  const shown = tiles.slice(0, MAX_TILES);
  return {
    tiles: shown,
    truncated: tiles.length > MAX_TILES,
    ambient: shown.some((tile) => tile.flags.some((flag) => ATTENTION_FLAGS.includes(flag))) ? 'attention' : 'calm',
  };
}

/** The same tiles as text lines: card id, label, quantity as the card prints it, and flags. */
export function describeModel(model: SceneModel): string[] {
  return model.tiles.map((tile) => {
    const quantity = tile.quantity.kind === 'none' ? 'no quantity' : tile.quantity.text;
    const flags = tile.flags.length === 0 ? 'no flags' : tile.flags.join(',');
    return `${tile.cardId} | ${tile.label} | ${quantity} | ${flags}`;
  });
}
