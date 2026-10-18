export interface MapPoint { x: number; y: number }

export interface MapAdapter {
  project(x: number, y: number): MapPoint;
  onResize(callback: () => void): () => void;
}

/** Stage A adapter: percentages map directly to a fictional 100 by 100 drawing. */
export class SchematicAdapter implements MapAdapter {
  constructor(private readonly element: HTMLElement) {}

  project(x: number, y: number): MapPoint {
    return { x: x - 50, y: 50 - y };
  }

  onResize(callback: () => void): () => void {
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', callback);
      return () => window.removeEventListener('resize', callback);
    }
    const observer = new ResizeObserver(callback);
    observer.observe(this.element);
    return () => observer.disconnect();
  }
}
