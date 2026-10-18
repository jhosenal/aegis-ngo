import type { Card } from '../../../../src/assist/contract.js';
import { Badge } from '../atoms/Badge.js';
import { Icon } from '../atoms/Icon.js';

export function LocationHeader({ card }: { card: Card }) {
  return <header className="assist-card-header">
    <div>
      {card.region && <p className="assist-region"><Icon name="location" /> Scenario region: {card.region}</p>}
      <h2 id={`assist-title-${card.id}`}>{card.title}</h2>
    </div>
    <Badge severity={card.severity} />
  </header>;
}
