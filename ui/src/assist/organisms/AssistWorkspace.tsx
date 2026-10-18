import { useEffect, useState, type ReactNode } from 'react';
import { Divider } from '../../components/Divider.js';
import { Sheet } from '../../components/Sheet.js';

// The layout of AEG-DEC-005 / AEG-ENG-006 section 2, applied to the public Assist page:
//  - desktop (at least 900 px): cards on the left, chat on the right, default ratio 2:1, with the keyboard- and pointer-operable divider;
//  - below 900 px: the chat is the main view and a "Cards (n)" button opens the cards in a sheet (focus trapped, Escape closes, focus returns).
// The cards are rendered in exactly one place at a time, so their controls are never duplicated in the page.

const WIDE_QUERY = '(min-width: 900px)';

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(WIDE_QUERY);
    const update = (): void => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export function AssistWorkspace({ cards, chat, cardCount }: { cards: ReactNode; chat: ReactNode; cardCount: number }) {
  const wide = useWide();
  const [split, setSplit] = useState(66.67);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (wide) {
    return <main className="assist-workspace" data-testid="assist-workspace" style={{ gridTemplateColumns: `minmax(480px, ${split}fr) 6px minmax(320px, ${100 - split}fr)` }}>
      <section className="assist-left" data-testid="assist-left" aria-label="Guidance cards">{cards}</section>
      <Divider value={split} onChange={setSplit} />
      <section className="assist-right" data-testid="assist-right" aria-label="Chat">{chat}</section>
    </main>;
  }
  return <>
    <main className="assist-workspace assist-workspace-narrow" data-testid="assist-workspace">
      <button type="button" className="assist-cards-button" data-testid="cards-button" onClick={() => setSheetOpen(true)}>Cards ({cardCount})</button>
      <section className="assist-right" data-testid="assist-right" aria-label="Chat">{chat}</section>
    </main>
    {sheetOpen && <Sheet title="Guidance cards" onClose={() => setSheetOpen(false)}>{cards}</Sheet>}
  </>;
}
