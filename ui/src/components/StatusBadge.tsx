import type { CardState } from '../../../src/types/domain.js';
import { statusLabel } from '../format.js';

export function StatusBadge({ state }: { state: CardState | 'awaiting-input' }) {
  return <span className={`status-badge status-${state}`} data-testid="card-status">{statusLabel(state)}</span>;
}
