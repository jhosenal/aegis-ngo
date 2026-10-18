import type { Card } from '../../../../src/assist/contract.js';

const severityLabels: Record<Card['severity'], string> = {
  high: 'High severity',
  moderate: 'Moderate severity',
  safe: 'Safe',
};

export function Badge({ severity }: { severity: Card['severity'] }) {
  return <span className={`assist-badge assist-badge-${severity}`} aria-label={`Severity: ${severityLabels[severity]}`}>
    {severityLabels[severity]}
  </span>;
}
