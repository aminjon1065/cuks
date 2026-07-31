import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Map as MlMap, NavigationControl, ScaleControl } from 'maplibre-gl';
import type {
  GeoJSONSource,
  MapLayerMouseEvent,
  MapMouseEvent,
  VectorTileSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { TerraDraw } from 'terra-draw';
import type { GeoJsonGeometry } from '@cuks/shared';
import {
  cssToken,
  INITIAL_CENTER,
  INITIAL_ZOOM,
  TAJIKISTAN_BOUNDS,
  tileUrl,
} from '../lib/map-config';
import { fetchSourceBounds, makeTransformRequest } from '../lib/tiles';
import {
  applyFilter,
  applyOpacity,
  applyVisibility,
  DRAWN_SOURCE,
  INCIDENT_CLUSTERS_LAYER_ID,
  INCIDENT_PULSE_LAYER_ID,
  INCIDENTS_LAYER_ID,
  incidentPulseFrame,
  layerState,
  SYSTEM_LAYERS,
  type LayerState,
  type MapLayerDef,
} from '../lib/layers';
import { buildStyle, type BasemapFlavor } from '../lib/basemap';
import { createIncidentRuntimeImage } from '../lib/incident-symbols';
import {
  createDrawing,
  editableGeometry,
  editModeFor,
  geometryOf,
  terraMode,
  type DrawTool,
} from '../lib/draw';
import { inspectableLayerIds, inspectFeatures, type InspectedFeature } from '../lib/inspect';
import { createBoxSelect } from '../lib/box-select';
import type { Bounds } from '../lib/geo';
import { downloadMapPng } from '../lib/map-snapshot';
import type { MapCamera } from '../lib/map-view-url';
import {
  MEASURE_FILL_LAYER,
  MEASURE_LINE_LAYER,
  MEASURE_POINTS_LAYER,
  MEASURE_SOURCE,
  measureCollection,
  measureReading,
  type LngLat,
  type MeasureMode,
  type MeasureReading,
} from '../lib/measure';

/** Imperative controls the page drives (zoom-to-layer, reset view, measure, PNG). */
export interface MapViewHandle {
  zoomToLayer: (source: string) => Promise<void>;
  fitBounds: (bounds: Bounds) => void;
  resetView: () => void;
  /** Current camera, or `null` before the map is ready. */
  getCamera: () => MapCamera | null;
  /** Jump the camera without animation (shared-view hydrate). */
  setCamera: (camera: MapCamera) => boolean;
  /** Drop the current measure sketch (keeps the active measure mode). */
  clearMeasure: () => void;
  /** Download a PNG of the current map view (docs/modules/10 §4). */
  exportPng: () => Promise<void>;
}

/** The feature open in the geometry editor. */
export interface EditingFeature {
  id: string;
  geometry: GeoJsonGeometry;
}

export interface MapViewProps {
  /** Explicit basemap flavor, or `null` to follow the app theme. */
  basemapOverride: BasemapFlavor | null;
  states: Record<string, LayerState>;
  /** Martin sources present in the catalog (stable once the map mounts). */
  availableSources: ReadonlySet<string> | null;
  /** Latest tile token (read per-request, so refreshes need no rebuild). */
  getToken: () => string | null;
  /** Filter/timeline query for the incident vector source (without token). */
  incidentTileQuery: string;
  /** The user's drawn layers, compiled from `GET /gis/layers` (memoized). */
  drawnDefs: readonly MapLayerDef[];
  /** Bumped after each drawn-feature write, to re-fetch the drawn tiles. */
  drawnRevision: number;
  /** Active drawing tool; `none` leaves the map in plain navigation mode. */
  tool: DrawTool;
  /** Color of the layer being drawn into (hex; falls back to the token). */
  drawColor: string;
  /** Feature loaded into the geometry editor, if any. */
  editing: EditingFeature | null;
  /** The edited geometry as it currently stands on the map (null = untouched).
   *  A style rebuild re-creates terra-draw, and it must come back holding what the
   *  user has dragged — not the geometry the edit started from. */
  pendingGeometry: GeoJsonGeometry | null;
  /** A finished sketch (create). The page persists it and bumps the revision. */
  onDrawFinish: (geometry: GeoJsonGeometry) => void;
  /** The edited feature's geometry after every vertex drag (not yet saved). */
  onEditGeometry: (geometry: GeoJsonGeometry) => void;
  /** Click / box-select result for the inspector (empty = nothing hit). */
  onInspect: (features: InspectedFeature[]) => void;
  /** Source-layers that stay on the map but are ignored by the inspector. */
  excludeInspectSources?: ReadonlySet<string>;
  /** Ephemeral distance/area measure tool (docs/modules/10 §4). */
  measureMode?: MeasureMode;
  /** Live reading for the measure HUD; `null` when idle or cleared. */
  onMeasureReading?: (reading: MeasureReading | null) => void;
}

declare global {
  interface Window {
    /** Dev/e2e diagnostic handle; never exposed by production builds. */
    __cuksMap?: MlMap;
    /** Dev/e2e handle on the drawing instance (terra-draw has no DOM surface). */
    __cuksDraw?: TerraDraw;
  }
}

/** The Protomaps flavor implied by the current app theme (`.dark` on <html>). */
function themeFlavor(): BasemapFlavor {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** id → title for the registry layers, so inspector rows can name their layer. */
function layerTitles(defs: readonly MapLayerDef[]): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  for (const def of defs) {
    const registry = def.drawn ?? def.imported;
    if (registry) titles.set(registry.id, registry.title);
  }
  return titles;
}

/**
 * MapLibre map wrapper (docs/modules/10 §4). Owns the map instance; the page
 * drives it declaratively (props) plus a small imperative handle. The style is
 * rebuilt only on theme/basemap/source/drawn-layer changes; visibility, opacity
 * and filters are applied in place so slider drags never rebuild. Colors are read
 * live from CSS tokens via a MutationObserver on the theme class, so a theme
 * toggle always restyles with the values actually in effect (no effect-ordering
 * races).
 *
 * Interaction (task 2.7): a click — or a shift+drag box — reports the features
 * under it to the inspector; terra-draw handles drawing and geometry editing and
 * exists only while a tool is active. What it draws is persisted through the API
 * and comes back as a vector tile, so its store is never the source of truth.
 */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    basemapOverride,
    states,
    availableSources,
    getToken,
    incidentTileQuery,
    drawnDefs,
    drawnRevision,
    tool,
    drawColor,
    editing,
    pendingGeometry,
    onDrawFinish,
    onEditGeometry,
    onInspect,
    excludeInspectSources,
    measureMode = 'none',
    onMeasureReading,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  // Mirror `ready` in a ref: the theme MutationObserver is registered once and
  // closes over the first render's functions, so it must read liveness (and all
  // other inputs) through refs, never the render-scoped `ready` state.
  const readyRef = useRef(false);
  // Bumped after every style rebuild: terra-draw renders through style layers, so
  // its instance has to be recreated once the new style is in place.
  const [styleEpoch, setStyleEpoch] = useState(0);

  // Refs keep the rebuild closure reading the latest props without re-subscribing.
  const statesRef = useRef(states);
  statesRef.current = states;
  const overrideRef = useRef(basemapOverride);
  overrideRef.current = basemapOverride;
  const availableSourcesRef = useRef(availableSources);
  availableSourcesRef.current = availableSources;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const incidentTileQueryRef = useRef(incidentTileQuery);
  incidentTileQueryRef.current = incidentTileQuery;
  const drawnDefsRef = useRef(drawnDefs);
  drawnDefsRef.current = drawnDefs;
  const excludeInspectSourcesRef = useRef(excludeInspectSources);
  excludeInspectSourcesRef.current = excludeInspectSources;
  const drawnRevisionRef = useRef(drawnRevision);
  drawnRevisionRef.current = drawnRevision;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // Read through a ref only: a dep on it would re-create the drawing instance on
  // every vertex drag.
  const pendingGeometryRef = useRef(pendingGeometry);
  pendingGeometryRef.current = pendingGeometry;
  const onDrawFinishRef = useRef(onDrawFinish);
  onDrawFinishRef.current = onDrawFinish;
  const onEditGeometryRef = useRef(onEditGeometry);
  onEditGeometryRef.current = onEditGeometry;
  const onInspectRef = useRef(onInspect);
  onInspectRef.current = onInspect;
  const measureModeRef = useRef(measureMode);
  measureModeRef.current = measureMode;
  const onMeasureReadingRef = useRef(onMeasureReading);
  onMeasureReadingRef.current = onMeasureReading;
  const measurePointsRef = useRef<LngLat[]>([]);
  const clearMeasureRef = useRef<() => void>(() => {
    measurePointsRef.current = [];
  });

  const drawRef = useRef<TerraDraw | null>(null);
  const editingId = editing?.id ?? null;

  function currentStyle() {
    return buildStyle({
      flavor: overrideRef.current ?? themeFlavor(),
      token: cssToken,
      states: statesRef.current,
      availableSources: availableSourcesRef.current,
      incidentTileQuery: incidentTileQueryRef.current,
      drawnDefs: drawnDefsRef.current,
      drawnTileQuery: `v=${drawnRevisionRef.current}`,
      hiddenFeatureId: editingRef.current?.id ?? null,
    });
  }

  function applyAllStates(map: MlMap): void {
    for (const def of [...SYSTEM_LAYERS, ...drawnDefsRef.current]) {
      const state = layerState(statesRef.current, def);
      applyVisibility(map, def, state.visible);
      applyOpacity(map, def, state.opacity);
    }
  }

  function rebuildStyle(): void {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setStyle(currentStyle());
    map.once('styledata', () => {
      applyAllStates(map);
      setStyleEpoch((epoch) => epoch + 1);
    });
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
      // Needed so `canvas.toBlob` can snapshot the view for PNG export.
      canvasContextAttributes: { preserveDrawingBuffer: true },
      transformRequest: makeTransformRequest(() => getTokenRef.current()),
    });
    map.addControl(new NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    // Shift+drag belongs to the rubber-band selection (docs/modules/10 §4), not to
    // box-zoom; the navigation control and the scroll wheel still zoom.
    map.boxZoom.disable();
    const addRuntimeImage = (event: { id: string }): void => {
      if (map.hasImage(event.id)) return;
      const image = createIncidentRuntimeImage(event.id, cssToken);
      if (image) map.addImage(event.id, image.data, { pixelRatio: image.pixelRatio });
    };
    map.on('styleimagemissing', addRuntimeImage);
    map.on('load', () => {
      readyRef.current = true;
      setReady(true);
    });
    const zoomCluster = (event: MapLayerMouseEvent): void => {
      // While drawing/measuring, a click places a vertex — flying the camera to a
      // cluster under it would move the map out from under the sketch.
      if (measureModeRef.current !== 'none') return;
      if (toolRef.current !== 'none' && toolRef.current !== 'select') return;
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const [lon, lat] = feature.geometry.coordinates;
      if (typeof lon !== 'number' || typeof lat !== 'number') return;
      map.easeTo({
        center: [lon, lat],
        zoom: Math.min(map.getZoom() + 2, 11),
        duration: 500,
      });
    };
    const showPointer = (): void => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const hidePointer = (): void => {
      map.getCanvas().style.cursor = '';
    };
    map.on('click', INCIDENT_CLUSTERS_LAYER_ID, zoomCluster);
    map.on('mouseenter', INCIDENT_CLUSTERS_LAYER_ID, showPointer);
    map.on('mouseleave', INCIDENT_CLUSTERS_LAYER_ID, hidePointer);
    mapRef.current = map;

    if (import.meta.env.DEV) window.__cuksMap = map;

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
      map.off('click', INCIDENT_CLUSTERS_LAYER_ID, zoomCluster);
      map.off('mouseenter', INCIDENT_CLUSTERS_LAYER_ID, showPointer);
      map.off('mouseleave', INCIDENT_CLUSTERS_LAYER_ID, hidePointer);
      map.off('styleimagemissing', addRuntimeImage);
      map.remove();
      mapRef.current = null;
      if (import.meta.env.DEV && window.__cuksMap === map) delete window.__cuksMap;
      setReady(false);
    };
    // Init once; prop/theme changes are handled by the dedicated effects and the
    // observers above (all read the latest values through refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Explicit basemap switch (Схема / Тёмная / За темой), source-set change, or a
  // drawn layer created/renamed/restyled/removed — each changes the layer list.
  useEffect(() => {
    rebuildStyle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStyle reads refs
  }, [basemapOverride, availableSources, drawnDefs, ready]);

  // Visibility / opacity — applied in place, no style rebuild.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyAllStates(map);
  }, [states, drawnDefs, ready, styleEpoch]);

  // Filters and timeline only replace the incident source's tile template. This
  // keeps the camera, basemap and all other source caches intact during playback.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('incidents_mvt') as VectorTileSource | undefined;
    source?.setTiles([tileUrl('incidents_mvt', incidentTileQuery)]);
  }, [incidentTileQuery, ready]);

  // A drawn feature was created/edited/deleted: re-fetch the drawn tiles (the
  // revision busts MapLibre's tile cache), leaving every other source alone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(DRAWN_SOURCE) as VectorTileSource | undefined;
    source?.setTiles([tileUrl(DRAWN_SOURCE, `v=${drawnRevision}`)]);
  }, [drawnRevision, ready]);

  // The feature under edit is rendered by terra-draw, so hide its tile copy.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const def of drawnDefs) applyFilter(map, def, editingId);
  }, [editingId, drawnDefs, ready, styleEpoch]);

  // Drawing / geometry editing. The instance lives only while a tool is active;
  // it is recreated after a style rebuild (setStyle drops its layers) and when the
  // target layer's color changes, so the sketch always matches the layer's style.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || tool === 'none') return;

    const draw = createDrawing(map, drawColor, cssToken('--surface', '#ffffff'));
    draw.start();
    draw.setMode(terraMode(tool));
    drawRef.current = draw;
    if (import.meta.env.DEV) window.__cuksDraw = draw;

    // A finished sketch is handed to the page, which persists it. It stays on
    // screen (in terra-draw's store) until the write lands and bumps the revision,
    // so a failed write leaves the drawing intact instead of losing the work.
    const onFinish = (id: string | number, context: { action: string }): void => {
      if (context.action !== 'draw') return;
      const feature = draw.getSnapshotFeature(id);
      const geometry = feature ? geometryOf(feature) : null;
      if (geometry) onDrawFinishRef.current(geometry);
    };
    const onChange = (ids: (string | number)[], type: string): void => {
      const current = editingRef.current;
      if (type !== 'update' || !current || !ids.includes(current.id)) return;
      const feature = draw.getSnapshotFeature(current.id);
      const geometry = feature ? geometryOf(feature) : null;
      if (geometry) onEditGeometryRef.current(geometry);
    };
    draw.on('finish', onFinish);
    draw.on('change', onChange);

    const current = editingRef.current;
    const live = pendingGeometryRef.current ?? current?.geometry ?? null;
    const geometry = live ? editableGeometry(live) : null;
    const mode = geometry ? editModeFor(geometry.type) : null;
    if (current && geometry && mode) {
      draw.addFeatures([{ id: current.id, type: 'Feature', geometry, properties: { mode } }]);
      if (tool === 'select') draw.selectFeature(current.id);
    }

    return () => {
      draw.off('finish', onFinish);
      draw.off('change', onChange);
      // The map or its style may already be gone (unmount / restyle); either way
      // the instance must go, and its own teardown then has nothing to remove.
      try {
        draw.stop();
      } catch {
        /* map or style already torn down */
      }
      drawRef.current = null;
      if (import.meta.env.DEV && window.__cuksDraw === draw) delete window.__cuksDraw;
    };
  }, [ready, styleEpoch, tool, drawColor, editingId]);

  // Once a create lands the feature arrives as a tile, so drop the sketch. While
  // editing, terra-draw holds the feature itself — leave its store alone. And a
  // shape being drawn right now is not a leftover: clearing it would delete work in
  // progress just because an earlier create happened to resolve.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || editingRef.current || draw.getModeState() === 'drawing') return;
    draw.clear();
  }, [drawnRevision]);

  // Inspector: a click reports what is under the cursor, a shift+drag box reports
  // everything inside it. Both are off while drawing (clicks place vertices) and
  // while editing (the panel holds the unsaved geometry).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const inspectable = (): boolean =>
      measureModeRef.current === 'none' &&
      (toolRef.current === 'none' || toolRef.current === 'select') &&
      !editingRef.current;
    const queryLayers = (): string[] =>
      inspectableLayerIds(SYSTEM_LAYERS, drawnDefsRef.current, {
        ...(excludeInspectSourcesRef.current
          ? { excludeSourceLayers: excludeInspectSourcesRef.current }
          : {}),
      }).filter((id) => map.getLayer(id));
    const report = (hits: ReturnType<MlMap['queryRenderedFeatures']>): void => {
      onInspectRef.current(inspectFeatures(hits, layerTitles(drawnDefsRef.current)));
    };

    const onClick = (event: MapMouseEvent): void => {
      if (!inspectable()) return;
      report(map.queryRenderedFeatures(event.point, { layers: queryLayers() }));
    };
    map.on('click', onClick);
    const disposeBox = createBoxSelect(map, {
      enabled: inspectable,
      onSelect: (box) => report(map.queryRenderedFeatures(box, { layers: queryLayers() })),
    });

    return () => {
      map.off('click', onClick);
      disposeBox();
    };
  }, [ready, styleEpoch, excludeInspectSources]);

  // Active incidents get a restrained halo. The loop exists only while an
  // active marker is rendered; hidden/empty/reduced-motion maps stay idle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameId = 0;
    let lastPaint = 0;
    const stop = (): void => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
    };
    const paint = (time: number): void => {
      if (time - lastPaint >= 33 && map.getLayer(INCIDENT_PULSE_LAYER_ID)) {
        const progress = (time % 1400) / 1400;
        const frame = incidentPulseFrame(progress);
        const opacity = statesRef.current[INCIDENTS_LAYER_ID]?.opacity ?? 1;
        map.setPaintProperty(INCIDENT_PULSE_LAYER_ID, 'circle-radius', frame.radius);
        map.setPaintProperty(INCIDENT_PULSE_LAYER_ID, 'circle-opacity', frame.opacity * opacity);
        lastPaint = time;
      }
      frameId = window.requestAnimationFrame(paint);
    };
    const sync = (): void => {
      stop();
      const state = statesRef.current[INCIDENTS_LAYER_ID];
      if (
        reducedMotion.matches ||
        !state?.visible ||
        state.opacity <= 0 ||
        !map.getLayer(INCIDENT_PULSE_LAYER_ID)
      ) {
        return;
      }
      const hasActiveMarker =
        map.queryRenderedFeatures({ layers: [INCIDENT_PULSE_LAYER_ID] }).length > 0;
      if (hasActiveMarker) frameId = window.requestAnimationFrame(paint);
    };

    map.on('idle', sync);
    map.on('moveend', sync);
    reducedMotion.addEventListener('change', sync);
    sync();
    return () => {
      stop();
      map.off('idle', sync);
      map.off('moveend', sync);
      reducedMotion.removeEventListener('change', sync);
    };
  }, [incidentTileQuery, ready, states]);

  // Ephemeral measure overlay: click to add vertices; Escape clears; double-click
  // finishes an area ring. Sketch lives only in a GeoJSON source — never persisted.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const ensureLayers = (): void => {
      if (!map.getSource(MEASURE_SOURCE)) {
        map.addSource(MEASURE_SOURCE, {
          type: 'geojson',
          data: measureCollection('distance', []),
        });
      }
      if (!map.getLayer(MEASURE_FILL_LAYER)) {
        map.addLayer({
          id: MEASURE_FILL_LAYER,
          type: 'fill',
          source: MEASURE_SOURCE,
          filter: ['==', ['get', 'kind'], 'fill'],
          paint: {
            'fill-color': cssToken('--primary', '#1d4ed8'),
            'fill-opacity': 0.15,
          },
        });
      }
      if (!map.getLayer(MEASURE_LINE_LAYER)) {
        map.addLayer({
          id: MEASURE_LINE_LAYER,
          type: 'line',
          source: MEASURE_SOURCE,
          filter: ['==', ['get', 'kind'], 'line'],
          paint: {
            'line-color': cssToken('--primary', '#1d4ed8'),
            'line-width': 2,
            'line-dasharray': [2, 1.5],
          },
        });
      }
      if (!map.getLayer(MEASURE_POINTS_LAYER)) {
        map.addLayer({
          id: MEASURE_POINTS_LAYER,
          type: 'circle',
          source: MEASURE_SOURCE,
          filter: ['==', ['get', 'kind'], 'vertex'],
          paint: {
            'circle-radius': 4,
            'circle-color': cssToken('--surface', '#ffffff'),
            'circle-stroke-color': cssToken('--primary', '#1d4ed8'),
            'circle-stroke-width': 2,
          },
        });
      }
    };

    const publish = (points: LngLat[]): void => {
      measurePointsRef.current = points;
      const mode = measureModeRef.current;
      ensureLayers();
      const source = map.getSource(MEASURE_SOURCE) as GeoJSONSource | undefined;
      if (mode === 'none') {
        source?.setData(measureCollection('distance', []));
        onMeasureReadingRef.current?.(null);
        return;
      }
      source?.setData(measureCollection(mode, points));
      onMeasureReadingRef.current?.(points.length > 0 ? measureReading(mode, points) : null);
    };

    const clear = (): void => publish([]);
    clearMeasureRef.current = clear;

    // Style rebuilds drop custom sources — re-attach after each epoch.
    ensureLayers();
    if (measureMode === 'none') {
      publish([]);
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = '';
      return () => {
        clearMeasureRef.current = () => {
          measurePointsRef.current = [];
        };
      };
    }

    publish(measurePointsRef.current);
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';

    const onClick = (event: MapMouseEvent): void => {
      if (measureModeRef.current === 'none') return;
      const { lng, lat } = event.lngLat;
      publish([...measurePointsRef.current, [lng, lat]]);
    };
    const onDblClick = (event: MapMouseEvent): void => {
      if (measureModeRef.current !== 'area') return;
      event.preventDefault();
      // Double-click already fired clicks that may have duplicated the last vertex.
      const points = measurePointsRef.current;
      if (points.length >= 2) {
        const last = points[points.length - 1]!;
        const prev = points[points.length - 2]!;
        if (Math.abs(last[0] - prev[0]) < 1e-9 && Math.abs(last[1] - prev[1]) < 1e-9) {
          publish(points.slice(0, -1));
        }
      }
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);

    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = '';
      clearMeasureRef.current = () => {
        measurePointsRef.current = [];
      };
    };
  }, [ready, styleEpoch, measureMode]);

  // Switching measure mode (including none ↔ tool) resets the sketch.
  useEffect(() => {
    measurePointsRef.current = [];
    onMeasureReadingRef.current?.(null);
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(MEASURE_SOURCE) as GeoJSONSource | undefined;
    source?.setData(measureCollection('distance', []));
  }, [measureMode, ready]);

  useImperativeHandle(ref, () => ({
    async zoomToLayer(source: string) {
      const map = mapRef.current;
      if (!map) return;
      const bounds = (await fetchSourceBounds(source, getTokenRef.current())) ?? TAJIKISTAN_BOUNDS;
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 600 });
    },
    fitBounds(bounds: Bounds) {
      mapRef.current?.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 600 });
    },
    resetView() {
      mapRef.current?.fitBounds(TAJIKISTAN_BOUNDS, { padding: 48, duration: 600 });
    },
    getCamera() {
      const map = mapRef.current;
      if (!map || !readyRef.current) return null;
      const center = map.getCenter();
      return { center: [center.lng, center.lat], zoom: map.getZoom() };
    },
    setCamera(camera: MapCamera) {
      const map = mapRef.current;
      if (!map || !readyRef.current) return false;
      map.jumpTo({ center: camera.center, zoom: camera.zoom });
      return true;
    },
    clearMeasure() {
      clearMeasureRef.current();
    },
    async exportPng() {
      const map = mapRef.current;
      if (!map) throw new Error('map_not_ready');
      await downloadMapPng(map);
    },
  }));

  // Fill the parent. Not `absolute inset-0`: MapLibre adds `.maplibregl-map`
  // (position: relative), which overrides Tailwind's `absolute` and collapses
  // the box to 0 height. A plain full-size block sizes correctly.
  return <div ref={containerRef} data-testid="map-canvas" className="h-full w-full" />;
});
