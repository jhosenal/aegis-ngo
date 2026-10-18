import { buildDropTag, type DropTagSpec } from './dropTag.js';
import { isGoogleTile, TileFailureWindow } from './mapHealth.js';
import { buildPlaceTag, type GoogleState, type TagPlace } from './placeTag.js';
import { clearGooglePlaceCache, lookupGooglePlace } from './googlePlace.js';
import { COUNTRY_CAMERA_BOUNDS } from './countryCamera.js';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { hazardIconPaths, hazardSymbol } from '../components/HazardIcon.js';
import type { CardViewData } from '../state/store.js';
import { ASEAN_VIEW_BOUNDS, coordinates, field } from './data.js';
import { temperatureBand, environmentPinLabel, type EnvPinView } from './environment.js';
import { AIR_WEATHER_ICON_PATH } from './Icon.js';
import { clusterByGrid } from './cluster.js';
import { cameraFor, lerpCamera, type Bounds } from './cameraPlan.js';
import { createClusterMarker } from './clusterMarker.js';
import { loadGoogleMaps } from './googleMaps.js';

export type MapStatus = 'unconfigured' | 'loading' | 'ready' | 'error';
export interface MapFrame { left: number; right: number; bottom: number }
export interface GoogleMapControls { zoom: (delta: number) => void; setZoom:(level:number)=>void; setType: (type: 'hybrid' | 'roadmap') => void; fitPoints: (points: { lat: number; lng: number }[]) => void }

export function GoogleMapCanvas({ apiKey, mapId, cards, onOpen, onStatus, onZoomChange, frame, country, ref, environmentPins, selectedEnvironmentId, onEnvironmentOpen, retry = 0 }: {
  /** Changes when the user presses Retry Google Maps: the loading effect runs again. */
  retry?: number;
  apiKey: string; mapId: string; cards: CardViewData[]; onOpen: (card: CardViewData) => void;
  onZoomChange?:(level:number)=>void;
  onStatus: (status: MapStatus) => void; ref: Ref<GoogleMapControls>;
  frame: MapFrame | null; country?: string;
  environmentPins?: EnvPinView[]; selectedEnvironmentId?: string | null; onEnvironmentOpen?: (id: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [imagery,setImagery]=useState<{kind:'missing'|'error'|'limit';zoom?:number}|null>(null);
  useImperativeHandle(ref, () => ({ zoom: (delta) => {
    if (map) map.setZoom(Math.max(3, Math.min(19, (map.getZoom() ?? 4) + delta)));
  }, setZoom:level=>map?.setZoom(Math.max(3,Math.min(19,level))), setType: type => map?.setMapTypeId(type), fitPoints: points => {
    if (!map || !points.length) return;
    const bounds = new google.maps.LatLngBounds(); points.forEach(point => bounds.extend(point)); map.fitBounds(bounds, 70);
  } }), [map]);

  useEffect(()=>{
    if(!map)return;
    const sync=()=>onZoomChange?.(map.getZoom()??4);
    sync();const listener=map.addListener('zoom_changed',sync);
    return()=>listener.remove();
  },[map,onZoomChange]);

  // Ask the supported Maps SDK about imagery at the viewport centre, not about
  // monitoring coverage. Debounced idle checks and session cache avoid pan chatter.
  useEffect(()=>{
    if(!map)return;
    let disposed=false;let revision=0;let timer=0;
    const cache=new Map<string,number>();
    const service=google.maps.MaxZoomService ? new google.maps.MaxZoomService() : null;
    const check=()=>{
      clearTimeout(timer);const request=++revision;
      const centre=map.getCenter();const zoom=map.getZoom()??4;
      setImagery(zoom>=18.95?{kind:'limit'}:null);
      if(!service||!centre||zoom<14||!['hybrid','satellite'].includes(map.getMapTypeId()??''))return;
      const point={lat:centre.lat(),lng:centre.lng()};
      const key=`${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
      const apply=(max:number)=>{if(!disposed&&request===revision)setImagery(zoom>max+.05?{kind:'missing',zoom:max}:zoom>=18.95?{kind:'limit'}:null);};
      if(cache.has(key)){apply(cache.get(key)!);return;}
      timer=window.setTimeout(()=>{
        void service.getMaxZoomAtLatLng(point).then(result=>{
          if(disposed||request!==revision||!Number.isFinite(result.zoom))return;
          if(cache.size>=40)cache.clear();cache.set(key,result.zoom);apply(result.zoom);
        }).catch(()=>{/* Unknown availability is never reported as absent imagery. */});
      },500);
    };
    // Only Google TILE images count (a broken marker or photo must not switch the basemap). A few misses show the imagery notice; many in a short time mean the basemap has failed and the page falls back.
    const tileFailures=new TileFailureWindow();
    const failed=(event:Event)=>{const img=event.target;if(!(img instanceof HTMLImageElement)||!isGoogleTile(img.currentSrc||img.src))return;setImagery({kind:'error'});if(tileFailures.record(Date.now()))onStatus('error');};
    canvas.current?.addEventListener('error',failed,true);
    const idle=map.addListener('idle',check);const type=map.addListener('maptypeid_changed',check);
    check();
    const box=canvas.current;
    return()=>{disposed=true;revision++;clearTimeout(timer);idle.remove();type.remove();box?.removeEventListener('error',failed,true);};
  },[map,onStatus]);

  // The news reader moves the camera while the presenter names a country (AEG-NEWS-006, formula in cameraPlan.ts): 'aegis-camera' {bounds, travelSec} and
  // 'aegis-camera-reset' {travelSec}. The move is eased and animated frame by frame; if the viewer prefers reduced motion the map dissolves instead of moving.
  useEffect(() => {
    if (!map) return;
    const root = canvas.current?.closest('.regional-map');
    if (!root) return;
    let saved: { lat: number; lng: number; zoom: number } | null = null;
    let frame = 0;
    let motion = 0;
    const here = () => { const c = map.getCenter(); return { lat: c?.lat() ?? 5, lng: c?.lng() ?? 115, zoom: map.getZoom() ?? 4 }; };
    const apply = (c: { lat: number; lng: number; zoom: number }) => { map.setCenter({ lat: c.lat, lng: c.lng }); map.setZoom(c.zoom); };
    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const dissolve = (to: { lat: number; lng: number; zoom: number }, seconds: number) => {
      const epoch = motion;
      const veil = document.createElement('div');
      veil.style.cssText = `position:absolute;inset:0;z-index:6;background:#102d42;opacity:0;pointer-events:none;transition:opacity ${seconds / 2}s ease`;
      root.appendChild(veil);
      requestAnimationFrame(() => { veil.style.opacity = '.9'; });
      window.setTimeout(() => { if(epoch !== motion){veil.remove();return;} apply(to); veil.style.opacity = '0'; window.setTimeout(() => veil.remove(), seconds * 500 + 50); }, seconds * 500);
    };
    const move = (to: { lat: number; lng: number; zoom: number }, seconds: number) => {
      cancelAnimationFrame(frame);
      motion++;
      if (reduced()) { dissolve(to, Math.min(seconds, 0.8)); return; }
      const from = here(); const started = performance.now();
      const tick = (now: number) => { const p = (now - started) / (seconds * 1000); apply(lerpCamera(from, to, p)); if (p < 1) frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick);
    };
    const go = (event: Event): void => {
      const d = (event as CustomEvent<{ bounds?: Bounds; point?: { lat: number; lng: number }; zoom?: number; travelSec: number }>).detail;
      if (!saved) saved = here();
      if (d.point && d.zoom) { move({ lat: d.point.lat, lng: d.point.lng, zoom: d.zoom }, d.travelSec); return; }   // street-level zoom on one place
      if (!d.bounds) return;
      const box = canvas.current;
      move(cameraFor(d.bounds, box?.clientWidth ?? 800, box?.clientHeight ?? 500, { top: 90, bottom: 90, left: 60, right: Math.round((box?.clientWidth ?? 800) * 0.4) }), d.travelSec);   // clear of the presenter on the right
    };
    const back = (event: Event): void => {
      const d = (event as CustomEvent<{ travelSec?: number }>).detail;
      if (saved) move(saved, d?.travelSec ?? 1.2);
      saved = null;
    };
    const hold = () => { cancelAnimationFrame(frame); motion++; saved=null; };
    root.addEventListener('aegis-camera-hold',hold);
    // Pin dropper (AEG-CREDIT-001): while the panel sets data-drop-mode a click reports its coordinates; the panel asks for a marker at the dropped point.
    let dropMarker: google.maps.marker.AdvancedMarkerElement | null = null;
    const click = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!(root as HTMLElement).dataset.dropMode || !e.latLng) return;
      root.dispatchEvent(new CustomEvent('aegis-drop', { detail: { lat: e.latLng.lat(), lng: e.latLng.lng() } }));
    });
    // The dropped pin: draggable, with a small tag ("Check this spot?") that the PinDropper keeps up to date. The tag opens below the pin when the pin is in the upper part of the map.
    let dropWrap: HTMLElement | null = null; let dropTagEl: HTMLElement | null = null;
    const marker = (event: Event): void => {
      const d = (event as CustomEvent<{ lat: number; lng: number; tag?: DropTagSpec } | null>).detail;
      if (!d) { if (dropMarker) { dropMarker.map = null; dropMarker = null; dropWrap = null; dropTagEl = null; } return; }
      if (!dropMarker || !dropWrap) {
        dropWrap = document.createElement('div'); dropWrap.className = 'dropped-wrap';
        const dot = document.createElement('div'); dot.className = 'dropped-pin'; dropWrap.appendChild(dot);
        dropMarker = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: d.lat, lng: d.lng }, content: dropWrap, title: 'Dropped pin (drag to move)', gmpDraggable: true, gmpClickable: true });
        dropMarker.addListener('dragend', () => {
          const p = dropMarker?.position; if (!p) return;
          const lat = typeof (p as google.maps.LatLng).lat === 'function' ? (p as google.maps.LatLng).lat() : (p as google.maps.LatLngLiteral).lat;
          const lng = typeof (p as google.maps.LatLng).lng === 'function' ? (p as google.maps.LatLng).lng() : (p as google.maps.LatLngLiteral).lng;
          root.dispatchEvent(new CustomEvent('aegis-drop', { detail: { lat, lng } }));
        });
      } else dropMarker.position = { lat: d.lat, lng: d.lng };
      const b = map.getBounds(); const ne = b?.getNorthEast(); const sw = b?.getSouthWest();
      const fromTop = ne && sw && ne.lat() !== sw.lat() ? (ne.lat() - d.lat) / (ne.lat() - sw.lat()) : 0.5;
      dropWrap.classList.toggle('is-below', fromTop < 0.45);
      if (dropTagEl) { dropTagEl.remove(); dropTagEl = null; }
      if (d.tag) { dropTagEl = buildDropTag(d.tag); dropWrap.appendChild(dropTagEl); }
    };
    const cursor = (event: Event): void => { map.setOptions({ draggableCursor: (event as CustomEvent<{ on: boolean }>).detail?.on ? 'crosshair' : null }); };
    // Nearby places (AEG-NEARBY-001): pins for the services the chat found, the centre marked, and the map view kept for "nearest ... here".
    let placeMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
    const placeById = new Map<string, { m: google.maps.marker.AdvancedMarkerElement; wrap: HTMLElement; place: TagPlace; tip: HTMLElement; google: GoogleState }>();
    const clearPlaces = (): void => { placeMarkers.forEach((m) => { m.map = null; }); placeMarkers = []; placeById.clear(); clearGooglePlaceCache(); };
    // Hover on a list row or chat card: that pin grows and shows its description card.
    const hover = (event: Event): void => {
      const id = (event as CustomEvent<{ id: string | null }>).detail?.id ?? null;
      placeById.forEach((v, key) => { const on = key === id; v.wrap.classList.toggle('is-hover', on); v.m.zIndex = on || v.wrap.classList.contains('is-picked') ? 1000 : null; });
    };
    // The pin of the card that was pressed keeps its small tag until another is pressed.
    const pick = (event: Event): void => {
      const id = (event as CustomEvent<{ id: string | null }>).detail?.id ?? null;
      placeById.forEach((v, key) => { const on = key === id; v.wrap.classList.toggle('is-picked', on); v.m.zIndex = on ? 1000 : null; });
      // The pressed pin asks Google Maps for phone, address and hours (once per place; allowance and caps in googlePlace.ts) and rebuilds its tag with them.
      const entry = id ? placeById.get(id) : undefined;
      if (entry && entry.google.kind === 'idle') {
        const swap = (state: GoogleState): void => { entry.google = state; const next = buildPlaceTag(entry.place, state); entry.wrap.replaceChild(next, entry.tip); entry.tip = next; };
        swap({ kind: 'loading' });
        void lookupGooglePlace(entry.place).then((r) => { if (placeById.get(id!) === entry) swap(r.kind === 'ok' || r.kind === 'limit' ? r : { kind: 'idle' }); });
      }
    };
    const places = (event: Event): void => {
      clearPlaces();
      const d = (event as CustomEvent<{ color: string; centre: { lat: number; lng: number }; places: { id: string; name: string; lat: number; lng: number; distanceM?: number; phone?: string | null; address?: string | null; website?: string | null; operator?: string | null; osmUrl?: string | null }[] } | null>).detail;
      if (!d) return;
      const mk = (cls: string, lat: number, lng: number, title: string, onClick?: () => void, place?: TagPlace): void => {
        // the wrapper grows on hover and shows a small description card; the pin inside keeps its own rotation
        const wrap = document.createElement('div'); wrap.className = 'nearby-wrap'; wrap.style.setProperty('--pin', d.color);
        const dot = document.createElement('div'); dot.className = cls; wrap.appendChild(dot);
        const tip = place ? buildPlaceTag(place) : undefined;
        if (tip) wrap.appendChild(tip);
        const m = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat, lng }, content: wrap, title, gmpClickable: onClick !== undefined });
        if (onClick) m.addListener('click', onClick);
        placeMarkers.push(m);
        if (place && tip) placeById.set(place.id, { m, wrap, place, tip, google: { kind: 'idle' } });
      };
      mk('nearby-centre', d.centre.lat, d.centre.lng, 'Search centre');
      d.places.forEach((p, i) => mk('nearby-pin', p.lat, p.lng, `${i + 1}. ${p.name}`, () => window.dispatchEvent(new CustomEvent('aegis-places-select', { detail: { id: p.id } })), p));
    };
    let demoPlaceMarker: google.maps.marker.AdvancedMarkerElement | null = null;
    const storedPlaceFocus = (event: Event): void => {
      const d = (event as CustomEvent<{ name: string; lat: number; lng: number }>).detail;
      if (!d || !Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return;
      if (demoPlaceMarker) demoPlaceMarker.map = null;
      const pin = document.createElement('div');
      pin.className = 'chat-location-pin';
      pin.textContent = d.name;
      demoPlaceMarker = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: d.lat, lng: d.lng }, content: pin, title: `${d.name} (stored location)` });
      root.dispatchEvent(new CustomEvent('aegis-camera', { detail: { point: { lat: d.lat, lng: d.lng }, zoom: 19, travelSec: 1.2 } }));
    };
    // 360 view (AEG-STREETVIEW-001): the map itself becomes Google's street-level view at ONE fixed spot. Walking is off (no click-to-go, no links, no keyboard steps):
    // every new spot would be another charged panorama. Looking around and zooming the picture stay.
    let pano: google.maps.StreetViewPanorama | null = null;
    let visibleWatch: google.maps.MapsEventListener | null = null;
    const noSteps = (e: KeyboardEvent): void => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'].includes(e.key)) { e.stopPropagation(); e.preventDefault(); } };
    const streetShow = (event: Event): void => {
      const d = (event as CustomEvent<{ pano: string; heading: number }>).detail;
      if (!d?.pano) return;
      pano = map.getStreetView();
      pano.setOptions({ clickToGo: false, linksControl: false, addressControl: false, fullscreenControl: false, motionTracking: false, motionTrackingControl: false, enableCloseButton: false, panControl: true, zoomControl: true, showRoadLabels: false, disableDoubleClickZoom: true });
      pano.setPano(d.pano); pano.setPov({ heading: d.heading, pitch: 5 }); pano.setZoom(1);
      canvas.current?.addEventListener('keydown', noSteps, true);
      visibleWatch?.remove();
      visibleWatch = pano.addListener('visible_changed', () => { if (pano && !pano.getVisible()) { canvas.current?.removeEventListener('keydown', noSteps, true); window.dispatchEvent(new CustomEvent('aegis-streetview-closed')); } });
      pano.setVisible(true);
    };
    const streetHide = (): void => { if (pano?.getVisible()) pano.setVisible(false); };
    window.addEventListener('aegis-streetview-show', streetShow); window.addEventListener('aegis-streetview-hide', streetHide);
    const idleView = map.addListener('idle', () => { const c = map.getCenter(); if (c) (window as Window & { __aegisView?: { lat: number; lng: number } }).__aegisView = { lat: c.lat(), lng: c.lng() }; });
    root.addEventListener('aegis-camera', go); root.addEventListener('aegis-camera-reset', back); root.addEventListener('aegis-drop-marker', marker); root.addEventListener('aegis-drop-cursor', cursor); root.addEventListener('aegis-places-markers', places); window.addEventListener('aegis-places-hover', hover); window.addEventListener('aegis-places-select', pick); window.addEventListener('aegis-stored-place-focus', storedPlaceFocus);
    return () => { hold(); root.removeEventListener('aegis-camera-hold',hold); click.remove(); idleView.remove(); clearPlaces(); if (dropMarker) dropMarker.map = null; if (demoPlaceMarker) demoPlaceMarker.map = null; root.removeEventListener('aegis-camera', go); root.removeEventListener('aegis-camera-reset', back); root.removeEventListener('aegis-drop-marker', marker); root.removeEventListener('aegis-drop-cursor', cursor); root.removeEventListener('aegis-places-markers', places); window.removeEventListener('aegis-places-hover', hover); window.removeEventListener('aegis-places-select', pick); window.removeEventListener('aegis-stored-place-focus', storedPlaceFocus); window.removeEventListener('aegis-streetview-show', streetShow); window.removeEventListener('aegis-streetview-hide', streetHide); visibleWatch?.remove(); canvas.current?.removeEventListener('keydown', noSteps, true); };
  }, [map]);

  useEffect(() => {
    if (!apiKey) { onStatus('unconfigured'); return; }
    let disposed = false;
    let error = false;
    let instance: google.maps.Map | null = null;
    let idle: google.maps.MapsEventListener | undefined;
    const failed = () => { error = true; if (!disposed) { setMap(null); onStatus('error'); } };
    const timeout = window.setTimeout(failed, 25_000);
    window.addEventListener('aegis-maps-auth-failure', failed);
    onStatus('loading');
    void loadGoogleMaps(apiKey).then((maps) => {
      if (disposed || error || !canvas.current) return;
      instance = new maps.Map(canvas.current, {
        center: { lat: 5, lng: 115 }, zoom: 4, minZoom: 3, maxZoom: 19, isFractionalZoomEnabled: true,
        mapId: mapId || 'DEMO_MAP_ID', mapTypeId: 'hybrid', gestureHandling: 'cooperative',
        zoomControl: false, cameraControl: false, streetViewControl: false, fullscreenControl: false,
        fullscreenControlOptions: { position: maps.ControlPosition.BOTTOM_RIGHT },
        mapTypeControl: false, backgroundColor:'#102d42',
      });
      setMap(instance);
      idle = maps.event.addListenerOnce(instance, 'idle', () => {
        clearTimeout(timeout);
        if (!disposed && !error) onStatus('ready');
      });
    }).catch(failed);
    return () => {
      disposed = true;
      clearTimeout(timeout);
      window.removeEventListener('aegis-maps-auth-failure', failed);
      idle?.remove();
      if (instance) google.maps.event.clearInstanceListeners(instance);
      canvas.current?.replaceChildren();
    };
  }, [apiKey, mapId, onStatus, retry]);

  useEffect(() => {
    if (!map || !canvas.current) return;
    map.setOptions({ mapTypeControl: false, fullscreenControl: false });
    // A 25% increase in map scale is log2(1.25) fractional Google zoom levels.
    const zoomBoost = Math.log2(1.25);
    let fitIdle: google.maps.MapsEventListener | null = null;
    const root = canvas.current.closest<HTMLElement>('.regional-map');
    const fit = () => {
      if (!canvas.current) return;
      if (root?.dataset.newsCamera === 'true') return;
      const full = document.fullscreenElement && root?.contains(document.fullscreenElement) ? document.fullscreenElement : null;
      const visibleWidth = full?.clientWidth ?? canvas.current.clientWidth;
      const wide = visibleWidth > 700;
      const phoneOffset = visibleWidth <= 767 ? 20 : 0;
      const presenterLeft = Number(root?.dataset.presenterLeft);
      const reserved = wide && presenterLeft > 0 ? Math.max(50, visibleWidth - presenterLeft + 24) : 50;
      // Include the eastern land margin in the camera fit so Papua/Australia do
      // not sit directly behind the presenter. Incident coordinates never change.
      const selectedBounds = country ? COUNTRY_CAMERA_BOUNDS[country] : undefined;
      if (selectedBounds) {
        // Keep the country on the map centreline. Symmetric clearance prevents
        // the reader reservation from pushing it into the left-hand side.
        const height = full?.clientHeight ?? canvas.current.clientHeight;
        let right = wide && presenterLeft > 0 ? visibleWidth-presenterLeft+24 : 64;
        if (wide && presenterLeft > 0) {
          // Keep every country camera's scale independent of the full-size
          // presenter: fit against the former 500px clearance consistently.
          const fixedGap = 64 * (visibleWidth / 1920) + 24;
          right = Math.round(fixedGap + (right - fixedGap) * (500 / 710));
        }
        const camera = cameraFor(selectedBounds, visibleWidth, height,
          {top:80,bottom:64,left:right,right}, 3, 19);
        map.setCenter({lat:camera.lat,lng:camera.lng});
        fitIdle?.remove();
        fitIdle = null;
        const indonesia = country === 'Indonesia';
        const malaysia = country === 'Malaysia';
        const myanmar = country === 'Myanmar';
        const singapore = country === 'Singapore';
        map.setZoom(Math.min(19, camera.zoom + zoomBoost + (indonesia ? 2 * Math.log2(1.1) : 0) + (myanmar ? Math.log2(1.25) : 0) + (singapore ? Math.log2(1.5) : 0)));
        if (indonesia) {
          // Frame the Indonesian archipelago as in the requested reference: westward on screen and lower in view.
          map.panBy(Math.round(visibleWidth * 0.14), -Math.round(height * 0.17));
        }
        if (malaysia) {
          // Shift the Malaysian peninsula and Borneo left to match the requested regional framing.
          map.panBy(Math.round(visibleWidth * 0.075), 0);
        }
        if (myanmar) {
          // Match the reference framing: bring Myanmar lower and slightly right,
          // with the requested additional 25% zoom.
          map.panBy(-Math.round(visibleWidth * 0.055), -Math.round(height * 0.17));
        }
        if (singapore) {
          // Move Singapore down in the viewport to match the latest reference,
          // while keeping the 50% close-up.
          map.panBy(0, -Math.round(height * 0.11));
        }
        if (phoneOffset) map.panBy(phoneOffset, phoneOffset);
        return;
      }
      const cameraBounds = selectedBounds ?? (wide ? { ...ASEAN_VIEW_BOUNDS, north: 48, south: -12, east: 156 } : ASEAN_VIEW_BOUNDS);
      const padding = frame ? {
        top: 100, bottom: frame.bottom, left: frame.left + 190, right: frame.right + 50,
      } : {
        // Two owner-requested 50px shifts, preserving the fit rectangle's width.
        top: wide ? 40 : 85, right: wide ? Math.max(0, reserved - 100) : reserved, bottom: 36,
        left: wide ? 290 : 20,
      };
      fitIdle?.remove();
      fitIdle = null;
      let listener: google.maps.MapsEventListener;
      listener = map.addListener('idle', () => {
        listener.remove();
        if (fitIdle === listener) fitIdle = null;
        map.setZoom(Math.min(19, (map.getZoom() ?? 4) + zoomBoost));
        // Move the default ASEAN geography up and left beneath the fixed toolbar/presenter.
        const w = canvas.current?.clientWidth ?? 1366;
        // On a phone preserve the Sumatra clearance, then move the geography
        // 20px left and up without moving Google's logo or map controls.
        map.panBy(Math.round(w * (w <= 767 ? -0.2 : 0.015)) + phoneOffset, Math.round((canvas.current?.clientHeight ?? 768) * 0.12) + phoneOffset);
      });
      fitIdle = listener;
      map.fitBounds(cameraBounds, padding);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas.current);
    root?.addEventListener('aegis-presenter-layout', fit);
    return () => { observer.disconnect(); fitIdle?.remove(); root?.removeEventListener('aegis-presenter-layout', fit); };
  }, [map, frame, country]);

  useEffect(() => {
    if (!map) return;
    let markers: google.maps.marker.AdvancedMarkerElement[] = [];
    let listeners: google.maps.MapsEventListener[] = [];
    const byId = new Map(cards.map(c => [c.card.cardId, c]));
    const points = cards.flatMap(c => { const p = coordinates(c.card); return p ? [{ id: c.card.cardId, ...p }] : []; });
    const clear = () => { listeners.forEach(l => l.remove()); markers.forEach(m => { m.map = null; }); listeners = []; markers = []; };
    const render = () => {
    clear();
    // Small fixture previews retain individual markers; live datasets cluster as the camera zooms.
    const zoom = cards.length > 12 ? Math.round(map.getZoom() ?? 4) : 11;
    for (const cluster of clusterByGrid(points, zoom)) {
      if (cluster.ids.length > 1) {
        const el = createClusterMarker(cluster.ids.map(id => String(field(byId.get(id)!.card, 'hazardType') ?? 'unknown')));
        const title = `${cluster.ids.length} ${el.dataset.clusterKind === 'mixed' ? 'mixed-disaster' : el.dataset.clusterKind} incident locations. Zoom in to explore; this is not an impact area.`;
        const marker = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: cluster.lat, lng: cluster.lng }, content: el, title, gmpClickable: true });
        listeners.push(marker.addListener('click', () => {
          const bounds = new google.maps.LatLngBounds();
          for (const id of cluster.ids) { const point = coordinates(byId.get(id)!.card); if (point) bounds.extend(point); }
          map.fitBounds(bounds, 80);
        }));
        markers.push(marker);
        continue;
      }
      const card = byId.get(cluster.ids[0]!)!;
      const point = coordinates(card.card);
      if (!point) continue;
      const hazard = String(field(card.card, 'hazardType') ?? 'unknown');
      const symbol = document.createElement('div');
      symbol.className = `google-hazard-marker regional-map-marker hazard-theme-${hazardSymbol(hazard)}`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({ viewBox: '-1 -1 26 26', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', hazardIconPaths[hazardSymbol(hazard)]);
      svg.append(path);
      symbol.append(svg);
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map, position: point, content: symbol, gmpClickable: true,
        title: `Open ${card.card.title}${card.card.body.synthetic ? ', demo' : ''}${!card.card.body.synthetic && String(field(card.card, 'hazardType')).toLowerCase() === 'storm' ? ' - Storm position (GDACS)' : ''}`,
      });
      listeners.push(marker.addListener('click', () => onOpen(card)));
      markers.push(marker);
    }
    };
    render();
    const idle = map.addListener('idle', render);
    return () => { idle.remove(); clear(); };
  }, [map, cards, onOpen]);

  useEffect(() => {
    if (!map || !environmentPins?.length || !onEnvironmentOpen) return;
    let markers: google.maps.marker.AdvancedMarkerElement[] = [];
    let listeners: google.maps.MapsEventListener[] = [];
    const byId = new Map(environmentPins.map(pin => [pin.pinId, pin]));
    const points = environmentPins.map(pin => ({ id: pin.pinId, lat: pin.lat, lng: pin.lng }));
    const clear = () => { listeners.forEach(l => l.remove()); markers.forEach(m => { m.map = null; }); markers = []; listeners = []; };
    const render = () => {
      clear();
      for (const cluster of clusterByGrid(points, Math.round(map.getZoom() ?? 4), 56, new Set(selectedEnvironmentId ? [selectedEnvironmentId] : []))) {
        const many = cluster.ids.length > 1;
        const pin = byId.get(cluster.ids[0]!)!;
        const symbol = many ? createClusterMarker(cluster.ids.map(() => 'weather'), true) : document.createElement('div');
        if (!many) {
          symbol.className = 'environment-pin';
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          for (const [key, value] of Object.entries({ viewBox:'0 0 24 24', width:'20', height:'20', fill:'none', stroke:'currentColor', 'stroke-width':'1.5', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true' })) svg.setAttribute(key,value);
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d',AIR_WEATHER_ICON_PATH); svg.append(path); symbol.append(svg);
          const reading=environmentPinLabel(pin);
          if(reading){const label=document.createElement('div');label.className='environment-reading-label';label.title=reading.description;const value=document.createElement('span');value.textContent=reading.text;const credit=document.createElement('small');credit.textContent='Google';label.append(value,credit);symbol.append(label);}

        }
        symbol.dataset.locationCount = String(cluster.ids.length);
        const band = many ? null : temperatureBand(pin);
        if (band) { symbol.style.boxShadow = `0 0 0 6px ${band.color},0 2px 7px #0008`; symbol.dataset.temperatureBand = band.id; }
        const marker = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: cluster.lat, lng: cluster.lng }, content: symbol, gmpClickable: true,
          title: many ? `${cluster.ids.length} air and weather monitoring locations. Zoom in to explore.` : `Air and weather: ${pin.name}. Monitoring location, not a condition assessment.${band ? ` Temperature ring: ${band.label} (one live reading, not a heat alert).` : ''}${environmentPinLabel(pin) ? ` ${environmentPinLabel(pin)!.description}` : ''}` });
        listeners.push(marker.addListener('click', () => {
          if (!many) { onEnvironmentOpen(pin.pinId); return; }
          const bounds = new google.maps.LatLngBounds(); cluster.ids.forEach(id => bounds.extend(byId.get(id)!)); map.fitBounds(bounds, 70);
        }));
        markers.push(marker);
      }
    };
    render(); const idle = map.addListener('idle', render);
    const expiry = setInterval(render, 60_000);   // a ring disappears when its reading passes the one-hour limit
    return () => { clearInterval(expiry); idle.remove(); clear(); };
  }, [map, environmentPins, selectedEnvironmentId, onEnvironmentOpen]);

  return <><div ref={canvas} className="google-map-canvas" aria-label="Google Maps ASEAN incident map"/>
    {map&&imagery&&<aside className="map-imagery-notice" role="status"><strong>{imagery.kind==='missing'?'Imagery unavailable at this zoom':imagery.kind==='limit'?'No more map detail at this zoom':'Map imagery unavailable'}</strong></aside>}
  </>;
}
