import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Map as MlMap, NavigationControl, ScaleControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cssToken, INITIAL_CENTER, INITIAL_ZOOM, TAJIKISTAN_BOUNDS } from '../lib/map-config';
import { fetchSourceBounds, makeTransformRequest } from '../lib/tiles';
import { applyOpacity, applyVisibility, SYSTEM_LAYERS, type LayerState } from '../lib/layers';
import { buildStyle, type BasemapFlavor } from '../lib/basemap';

/** Imperative controls the page drives (zoom-to-layer, reset view). */
export interface MapViewHandle {
  zoomToLayer: (source: string) => Promise<void>;
  resetView: () => void;
}

export interface MapViewProps {
  /** Explicit basemap flavor, or `null` to follow the app theme. */
  basemapOverride: BasemapFlavor | null;
  states: Record<string, LayerState>;
  /** Martin sources present in the catalog (stable once the map mounts). */
  availableSources: ReadonlySet<string> | null;
  /** Latest tile token (read per-request, so refreshes need no rebuild). */
  getToken: () => string | null;
}

/** The Protomaps flavor implied by the current app theme (`.dark` on <html>). */
function themeFlavor(): BasemapFlavor {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * MapLibre map wrapper (docs/modules/10 §4). Owns the map instance; the page
 * drives it declaratively (props) plus a small imperative handle. The style is
 * rebuilt only on theme/basemap/source changes; visibility and opacity are
 * applied in place so slider drags never rebuild. Colors are read live from CSS
 * tokens via a MutationObserver on the theme class, so a theme toggle always
 * restyles with the values actually in effect (no effect-ordering races).
 */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { basemapOverride, states, availableSources, getToken },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  // Mirror `ready` in a ref: the theme MutationObserver is registered once and
  // closes over the first render's functions, so it must read liveness (and all
  // other inputs) through refs, never the render-scoped `ready` state.
  const readyRef = useRef(false);

  // Refs keep the rebuild closure reading the latest props without re-subscribing.
  const statesRef = useRef(states);
  statesRef.current = states;
  const overrideRef = useRef(basemapOverride);
  overrideRef.current = basemapOverride;
  const availableSourcesRef = useRef(availableSources);
  availableSourcesRef.current = availableSources;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  function currentStyle() {
    return buildStyle({
      flavor: overrideRef.current ?? themeFlavor(),
      token: cssToken,
      states: statesRef.current,
      availableSources: availableSourcesRef.current,
    });
  }

  function applyAllStates(map: MlMap): void {
    for (const def of SYSTEM_LAYERS) {
      const state = statesRef.current[def.id];
      if (!state) continue;
      applyVisibility(map, def, state.visible);
      applyOpacity(map, def, state.opacity);
    }
  }

  function rebuildStyle(): void {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setStyle(currentStyle());
    map.once('styledata', () => applyAllStates(map));
  }

  // Create the map once; later prop/theme changes are handled by the effects below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new MlMap({
      container,
      style: currentStyle(),
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      maxZoom: 18,
      transformRequest: makeTransformRequest(() => getTokenRef.current()),
    });
    map.addControl(new NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('load', () => {
      readyRef.current = true;
      setReady(true);
    });
    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    // Restyle when the theme class flips: reads fresh tokens + follows the theme
    // flavor when no explicit basemap override is set.
    const themeObserver = new MutationObserver(() => rebuildStyle());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Init once; prop/theme changes are handled by the dedicated effects and the
    // observers above (all read the latest values through refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Explicit basemap switch (Схема / Тёмная / За темой) or source-set change.
  useEffect(() => {
    rebuildStyle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStyle reads refs
  }, [basemapOverride, availableSources, ready]);

  // Visibility / opacity — applied in place, no style rebuild.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyAllStates(map);
  }, [states, ready]);

  useImperativeHandle(ref, () => ({
    async zoomToLayer(source: string) {
      const map = mapRef.current;
      if (!map) return;
      const bounds = (await fetchSourceBounds(source, getTokenRef.current())) ?? TAJIKISTAN_BOUNDS;
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 600 });
    },
    resetView() {
      mapRef.current?.fitBounds(TAJIKISTAN_BOUNDS, { padding: 48, duration: 600 });
    },
  }));

  // Fill the parent. Not `absolute inset-0`: MapLibre adds `.maplibregl-map`
  // (position: relative), which overrides Tailwind's `absolute` and collapses
  // the box to 0 height. A plain full-size block sizes correctly.
  return <div ref={containerRef} data-testid="map-canvas" className="h-full w-full" />;
});
