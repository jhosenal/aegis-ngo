import type { Card, PublicCard } from '../../../src/assist/contract.js';
import { CardContainer } from './organisms/CardContainer.js';
import { DisclaimerFooter } from './organisms/DisclaimerFooter.js';
import './assist.css';

export interface AssistPageProps {
  cards: PublicCard[];
  disclaimer: string;
  /** Supplying the opt-in callback enables CoachControls, which owns speech playback and status. */
  onSpeak?: (card: Card) => void;
}

export function AssistPage({ cards, disclaimer, onSpeak }: AssistPageProps) {
  return <div className="assist-page" role="region" aria-label="Aegis Assist public guidance">
    <header className="assist-page-header">
      <p className="assist-eyebrow">Public guidance</p>
      <h1>Aegis Assist</h1>
      <p>Review the scenario card and its sources.</p>
    </header>
    <section className="assist-card-list" aria-label="Emergency guidance cards">
      {cards.length > 0
        ? cards.map((item) => <CardContainer key={item.card.id} item={item} onSpeak={onSpeak} />)
        : <p className="assist-empty" role="status">No guidance cards are available for this view.</p>}
    </section>
    <DisclaimerFooter disclaimer={disclaimer} />
  </div>;
}
