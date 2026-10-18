interface DockProps {
  pins: string[];
  onSelect: (cardId: string) => void;
  onOverflow: () => void;
}

export function Dock({ pins, onSelect, onOverflow }: DockProps) {
  const visible = pins.slice(0, 5);
  const overflow = pins.length - visible.length;
  return (
    <nav className="dock" aria-label="Pinned cards" data-testid="dock">
      {visible.map((cardId) => <button key={cardId} className="dock-chip" data-testid={`dock-chip-${cardId}`} onClick={() => onSelect(cardId)}>{cardId}</button>)}
      {overflow > 0 && <button className="dock-overflow" data-testid="dock-overflow" onClick={onOverflow}>+{overflow}</button>}
    </nav>
  );
}
