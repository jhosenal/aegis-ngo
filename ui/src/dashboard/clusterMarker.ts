import { hazardIconPaths, hazardSymbol } from '../components/HazardIcon.js';
import { AIR_WEATHER_ICON_PATH } from './Icon.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let gradientSequence = 0;

/** Membership is supplied by the map grid; presentation never changes locations or counts. */
export function createClusterMarker(hazards: readonly string[], environment = false): HTMLDivElement {
  const types = new Set(hazards.map(hazardSymbol));
  const kind = environment ? 'weather' : types.size === 1 ? [...types][0]! : 'mixed';
  const element = document.createElement('div');
  element.className = `${environment ? 'environment-map-cluster' : 'live-map-cluster'} map-count-marker ${kind === 'mixed' ? 'cluster-mixed' : kind === 'weather' ? 'cluster-weather' : `hazard-theme-${kind}`}`;
  element.dataset.clusterKind = kind;
  const icon = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({ viewBox:'-1 -1 26 26', fill:'none', stroke:'currentColor', 'stroke-width':'1.8', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false', class:'cluster-icon' })) icon.setAttribute(key, value);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', kind === 'weather' ? AIR_WEATHER_ICON_PATH : kind === 'mixed' ? 'M3 7l9-4 9 4-9 4Z M3 12l9 4 9-4 M3 17l9 4 9-4' : hazardIconPaths[kind]);
  if (kind === 'mixed') {
    const defs = document.createElementNS(SVG_NS, 'defs');
    const gradient = document.createElementNS(SVG_NS, 'linearGradient');
    const id = `cluster-rainbow-${++gradientSequence}`;
    gradient.setAttribute('id', id); gradient.setAttribute('x2', '100%'); gradient.setAttribute('y2', '100%');
    ['#ff5252','#ffad33','#ffe15c','#50dc9b','#39c9ff','#8791ff','#e579ff'].forEach((color, index) => {
      const stop = document.createElementNS(SVG_NS, 'stop'); stop.setAttribute('offset', `${index / 6 * 100}%`); stop.setAttribute('stop-color', color); gradient.append(stop);
    });
    defs.append(gradient); icon.append(defs); path.setAttribute('stroke', `url(#${id})`);
  }
  icon.append(path);
  const count = document.createElement('span'); count.className = 'cluster-count'; count.textContent = String(hazards.length);
  element.append(icon, count);
  return element;
}
