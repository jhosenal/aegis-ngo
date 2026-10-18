import type { Epistemic } from '../../../src/types/domain.js';

const LABELS: Record<Epistemic, string> = {
  fact: 'FACT',
  calculation: 'CALCULATION',
  estimate: 'ESTIMATE',
  proposal: 'PROPOSAL',
  unknown: 'UNKNOWN',
};

export function EpistemicTag({ value, testId }: { value: Epistemic; testId: string }) {
  return <span className={`epistemic epistemic-${value}`} data-testid={testId}>{LABELS[value]}</span>;
}
