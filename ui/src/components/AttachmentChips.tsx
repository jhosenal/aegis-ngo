import type { CardRevision } from '../../../src/types/domain.js';

export interface AttachmentRef { cardId: string; revision: number }

export function AttachmentChips({ attachments, cards, onRemove }: { attachments: AttachmentRef[]; cards: CardRevision[]; onRemove: (cardId: string) => void }) {
  return <div className="attachment-chips" aria-label="Attached cards">
    {attachments.map((attachment) => {
      const latest = cards.find((card) => card.cardId === attachment.cardId)?.revision ?? attachment.revision;
      return <button data-testid={`attachment-chip-${attachment.cardId}`} key={attachment.cardId} onClick={() => onRemove(attachment.cardId)}>
        {attachment.cardId} r{attachment.revision}{latest > attachment.revision ? ` · newer r${latest} available` : ''} ×
      </button>;
    })}
  </div>;
}
