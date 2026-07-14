import type { Map as MlMap, PointLike } from 'maplibre-gl';

/**
 * Rubber-band multi-select (docs/modules/10 §4: «Мультивыбор рамкой»). Shift +
 * drag paints a box and reports it in screen coordinates; the caller turns it
 * into features via `queryRenderedFeatures`. MapLibre binds shift+drag to
 * box-zoom, so the map's `boxZoom` handler must be disabled for this to fire.
 */
export interface BoxSelectOptions {
  /** Called with the dragged box; skipped for click-sized boxes (< 4px). */
  onSelect: (box: [PointLike, PointLike]) => void;
  /** Gate — the drawing tools take over shift+drag while a mode is active. */
  enabled: () => boolean;
}

const MIN_BOX_PX = 4;

export function createBoxSelect(map: MlMap, options: BoxSelectOptions): () => void {
  const container = map.getCanvasContainer();
  let box: HTMLDivElement | null = null;
  let start: { x: number; y: number } | null = null;

  const relative = (event: MouseEvent): { x: number; y: number } => {
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const paint = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    if (!box) return;
    box.style.left = `${Math.min(from.x, to.x)}px`;
    box.style.top = `${Math.min(from.y, to.y)}px`;
    box.style.width = `${Math.abs(to.x - from.x)}px`;
    box.style.height = `${Math.abs(to.y - from.y)}px`;
  };

  const cleanup = (): void => {
    box?.remove();
    box = null;
    start = null;
    map.dragPan.enable();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('blur', cleanup);
  };

  const onMove = (event: MouseEvent): void => {
    if (!start) return;
    // The button came up somewhere we never saw it (outside the window, over a
    // native dialog, during a devtools break). Without this the map would stay
    // un-pannable and the next click anywhere would fire a bogus selection.
    if (event.buttons === 0) {
      cleanup();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className =
        'pointer-events-none absolute z-10 rounded-sm border border-primary bg-primary/10';
      box.dataset['testid'] = 'map-box-select';
      container.append(box);
    }
    paint(start, relative(event));
  };

  const onUp = (event: MouseEvent): void => {
    const from = start;
    const drawn = box !== null;
    cleanup();
    if (!from || !drawn) return;
    const to = relative(event);
    if (Math.abs(to.x - from.x) < MIN_BOX_PX && Math.abs(to.y - from.y) < MIN_BOX_PX) return;
    options.onSelect([
      [Math.min(from.x, to.x), Math.min(from.y, to.y)],
      [Math.max(from.x, to.x), Math.max(from.y, to.y)],
    ]);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') cleanup();
  };

  const onDown = (event: MouseEvent): void => {
    if (!event.shiftKey || event.button !== 0 || !options.enabled()) return;
    // Own the gesture: without this the map pans under the box.
    event.preventDefault();
    map.dragPan.disable();
    start = relative(event);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    // The window losing focus mid-drag (alt-tab) also ends the gesture.
    window.addEventListener('blur', cleanup);
  };

  container.addEventListener('mousedown', onDown);
  return () => {
    container.removeEventListener('mousedown', onDown);
    cleanup();
  };
}
