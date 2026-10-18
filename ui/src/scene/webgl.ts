/** True when the browser can create a WebGL context. Probing never logs an error, unlike constructing a renderer that fails. */
export function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null || probe.getContext('webgl') !== null;
  } catch {
    return false;
  }
}
