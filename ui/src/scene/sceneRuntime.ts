import {
  AmbientLight, BoxGeometry, CanvasTexture, Color, DirectionalLight, EdgesGeometry, Fog, Group, LineBasicMaterial,
  GridHelper, LineSegments, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Sprite,
  SpriteMaterial, WebGLRenderer,
} from 'three';
import type { BufferGeometry, Material, Texture } from 'three';
import type { SceneModel, SceneTile } from './projection.js';

export { SCENE_DARKEST } from './palette.js';

const ACCENT = '#176e5a';
const FLAG_COLORS: Record<string, string> = {
  COORD_INVALID: '#c0483a', CONFLICTING: '#e0a82e', STALE: '#7b8f99', SUPERSEDED: '#8a7bb5',
};
const MAX_LABELLED_TILES = 24;
const SPACING = 1.7;

export interface SceneOptions {
  /** Draw exactly one frame with a fixed camera and time zero (screenshots and tests). */
  frozen: boolean;
  /** Draw one static frame and keep no loop running. */
  reducedMotion: boolean;
  mobile: boolean;
  onFrame?: (count: number) => void;
  onContextLost?: () => void;
}
export interface SceneHandle { update(model: SceneModel): void; dispose(): void }

function heightFor(tile: SceneTile): number {
  if (tile.quantity.kind === 'units') return 0.35 + 2.2 * (1 - Math.exp(-tile.quantity.units / 60));   // presentational; the exact number is in the label
  return tile.quantity.kind === 'unknown' ? 1 : 0.12;
}

function colorFor(tile: SceneTile): string {
  for (const flag of ['COORD_INVALID', 'CONFLICTING', 'STALE', 'SUPERSEDED']) if (tile.flags.includes(flag as never)) return FLAG_COLORS[flag] ?? ACCENT;
  return ACCENT;
}

function labelTexture(tile: SceneTile): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(255,255,255,0.82)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#1d2b29';
    context.font = '600 28px system-ui, sans-serif';
    context.textBaseline = 'middle';
    context.fillText(tile.label, 16, 30, 480);                                   // data as canvas text only, never HTML
    context.font = '24px system-ui, sans-serif';
    context.fillText(tile.quantity.kind === 'none' ? 'no quantity' : tile.quantity.text, 16, 68, 480);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createScene(canvas: HTMLCanvasElement, options: SceneOptions): SceneHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: !options.mobile, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(new Color('#ffffff'), 0);
  const scene = new Scene();
  scene.fog = new Fog('#e3ede8', 9, 26);
  const camera = new PerspectiveCamera(42, 1, 0.1, 60);
  scene.add(new AmbientLight('#ffffff', 1.6));
  const sun = new DirectionalLight('#ffffff', 1.9);
  sun.position.set(4, 8, 5);
  scene.add(sun);

  const floor = new Mesh(new PlaneGeometry(60, 60), new MeshStandardMaterial({ color: '#d4e3dc', transparent: true, opacity: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new GridHelper(60, 60, '#8fb3a4', '#b9cfc4');
  grid.position.y = 0.01;
  scene.add(grid);

  let group = new Group();
  scene.add(group);
  const disposables: Array<{ dispose(): void }> = [];
  let radius = 9;
  let centerX = 0;
  let centerZ = 0;
  let frames = 0;
  const angle = 0.6;
  let handle = 0;
  let disposed = false;
  const staticFrame = options.frozen || options.reducedMotion;

  function track<T extends BufferGeometry | Material | Texture>(item: T): T {
    disposables.push(item);
    return item;
  }

  function clearTiles(): void {
    scene.remove(group);
    while (disposables.length > 0) disposables.pop()?.dispose();
    group = new Group();
    scene.add(group);
  }

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.mobile ? 1 : 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function draw(seconds: number): void {
    if (disposed) return;
    const theta = options.frozen ? 0.6 : angle + seconds * 0.04;
    camera.position.set(centerX + Math.sin(theta) * radius, radius * 0.62, centerZ + Math.cos(theta) * radius);
    camera.lookAt(centerX, 0.4, centerZ);
    renderer.render(scene, camera);
    frames += 1;
    options.onFrame?.(frames);
  }

  function loop(now: number): void {
    handle = 0;
    if (disposed || document.visibilityState === 'hidden') return;
    draw(now / 1000);
    handle = requestAnimationFrame(loop);
  }

  function startLoop(): void {
    if (staticFrame || handle !== 0 || disposed) return;
    handle = requestAnimationFrame(loop);
  }

  function onVisibility(): void {
    if (document.visibilityState === 'visible') startLoop();
  }

  function onLost(event: Event): void {
    event.preventDefault();
    options.onContextLost?.();
  }

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { resize(); if (staticFrame) draw(0); });
  observer?.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onLost);
  resize();

  return {
    update(model: SceneModel): void {
      clearTiles();
      const count = model.tiles.length;
      const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
      const rows = Math.max(1, Math.ceil(count / columns));
      centerX = ((columns - 1) * SPACING) / 2;
      centerZ = ((rows - 1) * SPACING) / 2;
      radius = Math.max(6, Math.max(columns, rows) * SPACING * 1.35);
      model.tiles.forEach((tile, index) => {
        const height = heightFor(tile);
        const x = (index % columns) * SPACING;
        const z = Math.floor(index / columns) * SPACING;
        const box = track(new BoxGeometry(1.2, height, 1.2));
        if (tile.quantity.kind === 'unknown') {
          // Unknown is drawn as an outline only: it must never look like a zero-height tile.
          const edges = track(new EdgesGeometry(box));
          const lines = new LineSegments(edges, track(new LineBasicMaterial({ color: colorFor(tile) })));
          lines.position.set(x, height / 2, z);
          group.add(lines);
        } else {
          const mesh = new Mesh(box, track(new MeshStandardMaterial({ color: colorFor(tile), transparent: true, opacity: 0.82, roughness: 0.35 })));
          mesh.position.set(x, height / 2, z);
          group.add(mesh);
        }
        if (index < MAX_LABELLED_TILES) {
          const texture = track(labelTexture(tile));
          const sprite = new Sprite(track(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false })));
          sprite.scale.set(1.9, 0.36, 1);
          sprite.position.set(x, height + 0.45, z);
          group.add(sprite);
        }
      });
      draw(0);
      startLoop();
    },
    dispose(): void {
      disposed = true;
      if (handle !== 0) cancelAnimationFrame(handle);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      clearTiles();
      floor.geometry.dispose();
      grid.geometry.dispose();
      (grid.material as Material).dispose();
      (floor.material as MeshStandardMaterial).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
