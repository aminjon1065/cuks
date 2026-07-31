import type { Map as MlMap } from 'maplibre-gl';

/**
 * Capture the current MapLibre canvas as a PNG download (docs/modules/10 §4).
 * Requires `preserveDrawingBuffer: true` on the map constructor.
 */
export async function downloadMapPng(map: MlMap, filename = defaultMapPngName()): Promise<void> {
  await waitForIdle(map);
  const canvas = map.getCanvas();
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function defaultMapPngName(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `cuks-map-${stamp}.png`;
}

function waitForIdle(map: MlMap): Promise<void> {
  if (map.loaded() && !map.isMoving() && !map.isZooming() && !map.isRotating()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    map.once('idle', () => resolve());
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('map_png_empty'));
    }, 'image/png');
  });
}
