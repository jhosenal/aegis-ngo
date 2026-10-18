export function SyntheticBanner({ label }: { label: string | null }) {
  if (label === null) return null;
  return <div className="synthetic-banner" data-testid="synthetic-banner">Synthetic data: {label}</div>;
}
