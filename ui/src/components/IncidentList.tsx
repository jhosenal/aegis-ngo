import type { CardRevision } from '../../../src/types/domain.js';

export function IncidentList({ cards, selectedCardId, onSelect }: { cards: CardRevision[]; selectedCardId: string | null; onSelect: (cardId: string) => void }) {
  return <section className="incident-list" data-testid="incident-list" aria-label="Incidents">
    <h2>Incidents</h2>
    {cards.length === 0 ? <p data-testid="empty-incident-list">No incidents found.</p> : cards.filter((card) => card.kind === 'incident').map((card) => (
      <button className="incident-item" data-testid={`incident-item-${card.cardId}`} aria-current={selectedCardId === card.cardId} key={card.cardId} onClick={() => onSelect(card.cardId)}>
        <span>{card.title}</span><small>{card.state} · r{card.revision}</small>
      </button>
    ))}
  </section>;
}
