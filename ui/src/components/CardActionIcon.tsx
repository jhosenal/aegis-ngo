export function CardActionIcon({ kind }: { kind: 'pin' | 'attach' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={kind === 'pin' ? 'M9 3h6 M10 3v6l-4 4v2h12v-2l-4-4V3 M12 15v6' : 'M20 11l-8 8a5 5 0 01-7-7l9-9a3 3 0 014 4l-9 9a1 1 0 01-2-2l8-8'}/>
  </svg>;
}
