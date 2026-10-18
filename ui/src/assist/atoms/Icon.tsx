export type IconName = 'phone' | 'do' | 'avoid' | 'location' | 'shelter' | 'source';

const glyphs: Record<IconName, string> = {
  phone: '☎',
  do: '✓',
  avoid: '!',
  location: '⌖',
  shelter: '⌂',
  source: '↗',
};

export function Icon({ name }: { name: IconName }) {
  return <span className={`assist-icon assist-icon-${name}`} aria-hidden="true">{glyphs[name]}</span>;
}
