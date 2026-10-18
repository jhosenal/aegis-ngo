import type { Card, Source } from '../../../../src/assist/contract.js';
import { Icon } from '../atoms/Icon.js';

const kindLabels: Record<Card['lines'][number]['kind'], string> = {
  contact: 'Contact',
  step: 'Step',
  do: 'Do',
  dont: 'Avoid',
};

export function ActionRow({ line, source }: { line: Card['lines'][number]; source: Source | undefined }) {
  if (!source) return null;
  return <li className={`assist-action-row assist-action-${line.kind}`} data-line-kind={line.kind}>
    <h3>{line.kind === 'do' && <Icon name="do" />}{line.kind === 'dont' && <Icon name="avoid" />}{kindLabels[line.kind]}</h3>
    <p>{line.text}{line.condition && <><br /><span className="assist-condition">Condition: {line.condition}</span></>}</p>
  </li>;
}
