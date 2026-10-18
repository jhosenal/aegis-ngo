import { useState, type ReactNode } from 'react';
import type { CardViewData } from '../state/store.js';
import { Divider } from './Divider.js';
import { Dock } from './Dock.js';
import { Sheet } from './Sheet.js';

interface WorkspaceProps {
  cards: CardViewData[];
  pins: string[];
  selectedCardId: string | null;
  leftContent: ReactNode;
  rightContent: ReactNode;
  onSelectCard: (cardId: string | null) => void;
}

export function Workspace({ cards, pins, selectedCardId, leftContent, rightContent, onSelectCard }: WorkspaceProps) {
  const [split, setSplit] = useState(66.67);
  const [sheet, setSheet] = useState<'cards' | 'pins' | null>(null);
  return <>
    <button className="cards-button" data-testid="cards-button" onClick={() => setSheet('cards')}>Cards ({cards.length})</button>
    <main className="workspace-grid" data-testid="workspace" style={{ gridTemplateColumns: `minmax(480px, ${split}fr) 6px minmax(320px, ${100 - split}fr)` }}>
      <section className="workspace-left" data-testid="workspace-left" aria-label="Card workspace">{leftContent}</section>
      <Divider value={split} onChange={setSplit} />
      <section className="workspace-right" data-testid="workspace-right" aria-label="Chat workspace">{rightContent}</section>
    </main>
    <Dock pins={pins} onSelect={(cardId) => onSelectCard(cardId)} onOverflow={() => setSheet('pins')} />
    {sheet && <Sheet title={sheet === 'cards' ? 'Cards' : 'Pinned cards'} onClose={() => setSheet(null)}>
      {(sheet === 'cards' ? cards.map((item) => item.card.cardId) : pins).map((cardId) => <button key={cardId} aria-current={selectedCardId === cardId} onClick={() => { onSelectCard(cardId); setSheet(null); }}>{cardId}</button>)}
    </Sheet>}
  </>;
}
