import type { PointerEvent } from 'react';

interface DividerProps {
  value: number;
  onChange: (value: number) => void;
}

export function Divider({ value, onChange }: DividerProps) {
  function move(event: PointerEvent<HTMLDivElement>): void {
    if (event.buttons === 0) return;
    const parent = event.currentTarget.parentElement;
    let bounds: { left: number; width: number } | undefined = parent?.getBoundingClientRect();
    // A display:contents wrapper has no box. Its children still define the resize area.
    if (parent && bounds?.width === 0) {
      const boxes = [...parent.children].map((child) => child.getBoundingClientRect()).filter((box) => box.width > 0);
      if (boxes.length) {
        const left = Math.min(...boxes.map((box) => box.left));
        bounds = { left, width: Math.max(...boxes.map((box) => box.right)) - left };
      }
    }
    if (!bounds || bounds.width === 0) return;
    onChange(Math.max(54.55, Math.min(75, ((event.clientX - bounds.left) / bounds.width) * 100)));
  }

  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize workspace and chat panels"
      aria-valuenow={Math.round(value)}
      aria-valuemin={55}
      aria-valuemax={75}
      tabIndex={0}
      data-testid="divider"
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={move}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onChange(Math.max(54.55, value - 2));
        if (event.key === 'ArrowRight') onChange(Math.min(75, value + 2));
      }}
    />
  );
}
