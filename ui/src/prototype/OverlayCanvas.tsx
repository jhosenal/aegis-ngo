import { useEffect, useRef } from 'react';
import type * as Three from 'three';
import type { MapAdapter } from './MapAdapter.js';
import { blinkOpacity, severityToken, type LayerModel } from './model.js';

interface Props {
  adapter: MapAdapter;
  model: LayerModel;
  selectedId: string | null;
  paused: boolean;
  reducedMotion: boolean;
  onSelect: (eventId: string) => void;
  onFallback: () => void;
}

interface DrawnPulse { material: Three.Material & { opacity: number }; severity: string; baseOpacity: number }
interface OverlayHandle { update: (model: LayerModel, selectedId: string | null, paused: boolean, reducedMotion: boolean) => void; dispose: () => void }

function tokenColor(three: typeof Three, name: string): Three.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new three.Color(value);
}

function createHandle(three: typeof Three, canvas: HTMLCanvasElement, adapter: MapAdapter, onSelect: (id: string) => void): OverlayHandle {
  const renderer = new three.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(tokenColor(three, '--aeg-surface'), 0);
  const scene = new three.Scene();
  const camera = new three.OrthographicCamera(-50, 50, 50, -50, 0.1, 200);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  const raycaster = new three.Raycaster();
  const pointer = new three.Vector2();
  const disposables: Array<{ dispose(): void }> = [];
  const pulses: DrawnPulse[] = [];
  let eventRoot = new three.Group();
  let hits: Three.Object3D[] = [];
  let model: LayerModel = { filter: 'all', generatedAt: '', events: [] };
  let selectedId: string | null = null;
  let paused = false;
  let reducedMotion = false;
  let animation = 0;
  let lastFrame = -Infinity;
  let startedAt = performance.now();
  let disposed = false;

  function track<T extends Three.BufferGeometry | Three.Material | Three.Texture>(item: T): T {
    disposables.push(item);
    return item;
  }

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const aspect = width / height;
    camera.left = -50 * aspect;
    camera.right = 50 * aspect;
    camera.top = 50;
    camera.bottom = -50;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    draw(performance.now());
  }

  function clear(): void {
    scene.remove(eventRoot);
    for (const item of disposables.splice(0)) item.dispose();
    pulses.length = 0;
    hits = [];
    eventRoot = new three.Group();
    scene.add(eventRoot);
  }

  function ringPiece(event: LayerModel['events'][number], x: number, y: number, start: number, arc: number, width: number, color: Three.Color): void {
    const radius = event.radius;
    const geometry = track(new three.RingGeometry(Math.max(0.5, radius - width), radius, 72, 1, start, arc));
    const critical = event.severity === 'CRITICAL';
    const material = track(new three.MeshBasicMaterial({ color, transparent: true, opacity: critical ? 0.9 : 0.82, depthWrite: false, side: three.DoubleSide }));
    const mesh = new three.Mesh(geometry, material);
    mesh.position.set(x, y, 0.35);
    mesh.userData.eventId = event.id;
    eventRoot.add(mesh);
    if (critical || event.severity === 'WARNING') pulses.push({ material, severity: event.severity, baseOpacity: critical ? 1 : 0.82 });
  }

  function drawEvents(): void {
    clear();
    const iconLoader = new three.TextureLoader();
    const surface = tokenColor(three, '--aeg-surface');
    for (const event of model.events) {
      const projected = adapter.project(event.x, event.y);
      const color = tokenColor(three, severityToken(event.severity));
      const areaMaterial = track(new three.MeshBasicMaterial({ color, transparent: true, opacity: event.severity === 'CRITICAL' ? 0.2 : 0.12, depthWrite: false, side: three.DoubleSide }));
      const area = new three.Mesh(track(new three.CircleGeometry(event.radius, 72)), areaMaterial);
      area.position.set(projected.x, projected.y, 0.1);
      area.userData.eventId = event.id;
      eventRoot.add(area);
      hits.push(area);

      const selected = event.id === selectedId;
      const thick = reducedMotion ? 1.5 : 0.75;
      if (selected) ringPiece({ ...event, radius: event.radius + 1.35 }, projected.x, projected.y, 0, Math.PI * 2, reducedMotion ? 1.8 : 1.35, color);
      if (event.severity === 'CRITICAL') ringPiece(event, projected.x, projected.y, 0, Math.PI * 2, thick, color);
      else if (event.severity === 'WARNING') {
        const count = 14;
        for (let index = 0; index < count; index += 1) ringPiece(event, projected.x, projected.y, index * Math.PI * 2 / count, Math.PI * 2 / count * 0.56, thick, color);
      } else {
        const count = 24;
        for (let index = 0; index < count; index += 1) {
          const angle = index * Math.PI * 2 / count;
          const dot = new three.Mesh(track(new three.CircleGeometry(reducedMotion ? 0.65 : 0.42, 10)), track(new three.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false })));
          dot.position.set(projected.x + Math.cos(angle) * event.radius, projected.y + Math.sin(angle) * event.radius, 0.4);
          eventRoot.add(dot);
        }
      }

      const plate = new three.Mesh(track(new three.CircleGeometry(1.7, 32)), track(new three.MeshBasicMaterial({ color: surface, depthWrite: false })));
      plate.position.set(projected.x, projected.y, 0.8);
      eventRoot.add(plate);
      const texture = track(iconLoader.load(`/brand/domains/${event.type}.png`));
      texture.colorSpace = three.SRGBColorSpace;
      const icon = new three.Sprite(track(new three.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })));
      icon.scale.set(2.25, 2.25, 1);
      icon.position.set(projected.x, projected.y, 1.1);
      eventRoot.add(icon);
    }
    startedAt = performance.now();
  }

  function draw(now: number): void {
    if (disposed) return;
    const seconds = (now - startedAt) / 1000;
    const warnings = 0.82 + 0.1 * Math.sin(2 * Math.PI * 0.16 * seconds);
    for (const pulse of pulses) {
      if (reducedMotion || paused || pulse.severity === 'WATCH') pulse.material.opacity = pulse.baseOpacity;
      else if (pulse.severity === 'CRITICAL') pulse.material.opacity = pulse.baseOpacity * blinkOpacity(seconds);
      else pulse.material.opacity = pulse.baseOpacity * warnings;
    }
    renderer.render(scene, camera);
  }

  function stop(): void {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
  }

  function loop(now: number): void {
    animation = 0;
    if (disposed || paused || reducedMotion || document.visibilityState === 'hidden') return;
    if (now - lastFrame >= 1000 / 30) {
      lastFrame = now;
      draw(now);
    }
    animation = requestAnimationFrame(loop);
  }

  function start(): void {
    if (!disposed && !paused && !reducedMotion && document.visibilityState === 'visible' && animation === 0) animation = requestAnimationFrame(loop);
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') stop();
    else start();
  }

  function onPointer(event: PointerEvent): void {
    const bounds = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hits, false)[0]?.object.userData.eventId;
    if (typeof hit === 'string') onSelect(hit);
  }

  const resizeSubscription = adapter.onResize(resize);
  canvas.addEventListener('pointerup', onPointer);
  document.addEventListener('visibilitychange', onVisibility);
  scene.add(eventRoot);
  resize();

  return {
    update(nextModel, nextSelectedId, nextPaused, nextReducedMotion) {
      model = nextModel;
      selectedId = nextSelectedId;
      paused = nextPaused;
      reducedMotion = nextReducedMotion;
      drawEvents();
      if (paused || reducedMotion) { stop(); draw(performance.now()); }
      else { start(); }
    },
    dispose() {
      disposed = true;
      stop();
      resizeSubscription();
      canvas.removeEventListener('pointerup', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      clear();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export function OverlayCanvas({ adapter, model, selectedId, paused, reducedMotion, onSelect, onFallback }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<OverlayHandle | null>(null);
  const latest = useRef({ model, selectedId, paused, reducedMotion, onSelect });
  latest.current = { model, selectedId, paused, reducedMotion, onSelect };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    let handle: OverlayHandle | null = null;
    void import('three').then((three) => {
      if (cancelled) return;
      try {
        handle = createHandle(three, canvas, adapter, (id) => latest.current.onSelect(id));
        handleRef.current = handle;
        const current = latest.current;
        handle.update(current.model, current.selectedId, current.paused, current.reducedMotion);
      } catch {
        onFallback();
      }
    }).catch(() => onFallback());
    return () => {
      cancelled = true;
      handle?.dispose();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [adapter, onFallback]);

  useEffect(() => { handleRef.current?.update(model, selectedId, paused, reducedMotion); }, [model, selectedId, paused, reducedMotion]);

  return <canvas ref={canvasRef} className="hazard-map-canvas" aria-hidden="true" data-testid="hazard-map-canvas" />;
}
