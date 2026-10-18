interface Props {
  paused: boolean;
  reducedMotion: boolean;
  onToggle: () => void;
}

export function HazardAnimationControl({ paused, reducedMotion, onToggle }: Props) {
  const isPaused = paused || reducedMotion;
  return <button
    type="button"
    className="hazard-map-pause"
    aria-pressed={isPaused}
    disabled={reducedMotion}
    aria-label={reducedMotion ? 'Play animation (disabled for reduced motion)' : isPaused ? 'Play animation' : 'Pause animation'}
    onClick={onToggle}
  >{isPaused ? 'Play' : 'Pause'}</button>;
}
