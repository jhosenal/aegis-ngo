import type { ReactNode } from 'react';
import { HazardIcon, hazardSymbol } from './HazardIcon.js';
import '../design/hazard-cards.css';

/** Decorative crops of the owner's illustration, never evidence of an incident. */
export function HazardArtwork({ hazard, className = '', badge }: { hazard: string; className?: string; badge?: ReactNode }) {
  const symbol = hazardSymbol(hazard);
  // Crop only photo regions; the gallery's baked-in symbols are excluded.
  const regions: Record<string, string> = {
    seismic: '44 120 510 230', hydrological: '581 120 510 230',
    meteorological: '1118 120 512 230', wildfire: '44 495 380 224',
    biological: '450 495 370 224', displacement: '850 495 371 224',
    volcanic: '1250 495 379 224',
  };
  const region = regions[symbol];
  return <span className={`hazard-artwork hazard-theme-${symbol} ${region ? 'has-illustration' : 'symbol-only'} ${className}`}>
    {region && <svg className="hazard-artwork-image" viewBox={region} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><image href="/brand/hazard-gallery.webp" width="1672" height="941"/></svg>}
    <span className="hazard-artwork-icon"><HazardIcon hazard={hazard} size={30}/></span>
    {badge && <span className="hazard-artwork-badge">{badge}</span>}
    <span className="hazard-artwork-caption">{region ? 'Illustrative image' : 'Hazard symbol'}</span>
  </span>;
}
