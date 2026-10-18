import type { Card } from '../../../../src/assist/contract.js';
import { ActionRow } from '../molecules/ActionRow.js';
import { Icon } from '../atoms/Icon.js';

export function ShelterBlock({ lines, sourceById }: {
  lines: Card['lines'];
  sourceById: Map<string, Card['sources'][number]>;
}) {
  if (lines.length === 0) return null;
  return <section className="assist-shelter-block" aria-label="Additional shelter and contact details">
    <h3><Icon name="shelter" /> Additional shelter and contact details</h3>
    <ul className="assist-actions">
      {lines.map((line) => <ActionRow key={line.id} line={line} source={sourceById.get(line.sourceId)} />)}
    </ul>
  </section>;
}
