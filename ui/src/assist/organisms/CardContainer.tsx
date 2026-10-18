import type { Card, PublicCard } from '../../../../src/assist/contract.js';
import { DEMO_BANNER_TEXT } from '../../../../src/assist/contract.js';
import { ContactButton } from '../molecules/ContactButton.js';
import { LocationHeader } from '../molecules/LocationHeader.js';
import { ActionRow } from '../molecules/ActionRow.js';
import { CoachControls } from '../audio/CoachControls.js';
import { ShelterBlock } from './ShelterBlock.js';

export function CardContainer({ item, onSpeak }: {
  item: PublicCard;
  onSpeak?: (card: Card) => void;
}) {
  const { card, demoBanner } = item;
  const sourceById = new Map(card.sources.map((source) => [source.sourceId, source]));
  const first = card.lines[0];
  const firstSource = first ? sourceById.get(first.sourceId) : undefined;
  const contactLines = card.lines.slice(1).filter((line) => line.kind === 'contact');
  const actionLines = card.lines.slice(1).filter((line) => line.kind !== 'contact');

  const published = card.sources.map((source) => source.published?.slice(0, 4)).filter((year): year is string => year !== undefined).sort();
  const oldest = published[0];

  return <article className="assist-card" aria-labelledby={`assist-title-${card.id}`}>
    {card.synthetic && <p className="assist-synthetic-banner" role="note">Synthetic example only. Not real emergency guidance.</p>}
    {demoBanner && <p className="assist-demo-banner" role="alert">{DEMO_BANNER_TEXT}</p>}
    <LocationHeader card={card} />
    {oldest && <p className="assist-source-date" role="note">Based on guidance published in {oldest}. Newer official advice may exist.</p>}
    <div className="assist-card-lines">
      {first?.kind === 'contact' && firstSource && <ContactButton line={first} sources={card.sources} />}
      <ul className="assist-actions" aria-label="Card instructions">
        {actionLines.map((line) => <ActionRow key={line.id} line={line} source={sourceById.get(line.sourceId)} />)}
      </ul>
      <ShelterBlock lines={contactLines} sourceById={sourceById} />
    </div>
    {onSpeak && <div className="assist-coach-controls"><CoachControls card={card} /></div>}
  </article>;
}
