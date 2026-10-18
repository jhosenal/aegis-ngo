interface PanelPullerProps {
  side: 'navigation' | 'assistant';
  expanded: boolean;
  onToggle: () => void;
}

/** Slim visual grip with a larger keyboard/touch target. */
export function PanelPuller({ side, expanded, onToggle }: PanelPullerProps) {
  const label = `${expanded ? 'Hide' : 'Show'} ${side === 'navigation' ? 'navigation' : 'Assist'}`;
  const pointsLeft = side === 'navigation' ? expanded : !expanded;
  return <button className={`panel-puller ${side}-puller ${expanded ? 'pull-expanded' : ''}`}
    type="button" data-panel-toggle={side} aria-label={label} title={label}
    aria-expanded={expanded} aria-controls={side === 'navigation' ? 'aegis-navigation' : 'aegis-assistant'}
    onClick={onToggle}>
    <span className="panel-puller-rail" aria-hidden="true"/>
    <svg width="14" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={pointsLeft ? 'M14 7l-5 5 5 5' : 'M10 7l5 5-5 5'}/>
    </svg>
  </button>;
}
