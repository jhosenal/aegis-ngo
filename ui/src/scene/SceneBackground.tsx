import { useEffect, useMemo, useRef } from 'react';
import { describeModel, projectCards, type ProjectionInput, type SceneModel } from './projection.js';
import type { SceneHandle } from './sceneRuntime.js';
import { webglAvailable } from './webgl.js';

declare global {
  interface Window { __AEGIS_SCENE_FROZEN__?: boolean }
}

const EMPTY: SceneModel = { tiles: [], truncated: false, ambient: 'calm' };

function safeProject(items: ProjectionInput[]): { model: SceneModel; error: string | null } {
  try {
    return { model: projectCards(items), error: null };
  } catch (reason: unknown) {
    // Fail loudly but safely: the app keeps working and the 3D view says why it is not drawing the cards.
    return { model: EMPTY, error: reason instanceof Error ? reason.message : 'The cards could not be projected' };
  }
}

/** Full-viewport 3D background. It never takes focus or pointer events, carries no information that the cards do not show, and falls back to a CSS gradient. */
export function SceneBackground({ items }: { items: ProjectionInput[] }) {
  const layer = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle | null>(null);
  const latest = useRef<SceneModel>(EMPTY);
  const { model, error } = useMemo(() => safeProject(items), [items]);
  latest.current = model;

  useEffect(() => {
    const element = layer.current;
    if (!element) return undefined;
    const frozen = new URLSearchParams(window.location.search).get('scene') === 'frozen' || window.__AEGIS_SCENE_FROZEN__ === true;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fallback = (reason: string): void => {
      element.dataset.sceneState = 'fallback';
      console.info(`3D background not drawn: ${reason}`);
    };
    if (!webglAvailable()) { fallback('WebGL is unavailable'); return undefined; }
    let cancelled = false;
    let canvas: HTMLCanvasElement | null = null;
    // Three.js is loaded on demand so the app itself stays small and starts first; the CSS gradient shows meanwhile.
    void import('./sceneRuntime.js').then(({ createScene }) => {
      if (cancelled) return;
      const target = document.createElement('canvas');
      target.setAttribute('aria-hidden', 'true');
      target.tabIndex = -1;
      target.dataset.testid = 'scene-canvas';
      element.appendChild(target);
      canvas = target;
      element.dataset.sceneFrames = '0';
      try {
        handle.current = createScene(target, {
          frozen, reducedMotion, mobile: window.innerWidth < 900,
          onFrame: (count) => { element.dataset.sceneFrames = String(count); },
          onContextLost: () => { handle.current?.dispose(); handle.current = null; target.remove(); fallback('the WebGL context was lost'); },
        });
      } catch {
        target.remove();
        fallback('the renderer could not start');
        return;
      }
      element.dataset.sceneState = frozen ? 'frozen' : reducedMotion ? 'static' : 'live';
      handle.current.update(latest.current);
    }).catch(() => fallback('the 3D module could not be loaded'));
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
      canvas?.remove();
    };
  }, []);

  useEffect(() => { handle.current?.update(model); }, [model]);

  return <>
    <div className="scene-layer" ref={layer} aria-hidden="true" data-testid="scene-layer" data-ambient={model.ambient} data-scene-lines={JSON.stringify(describeModel(model))} />
    {error && <p className="scene-notice" role="status" data-testid="scene-error">3D view unavailable: {error}</p>}
  </>;
}
