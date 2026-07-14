import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  Map as MlMap,
} from 'maplibre-gl';
import type { GisLayerDto } from '@cuks/shared';
import type { TokenResolver } from './map-config';

/**
 * Layer registry (docs/modules/10 §3/§4). Two kinds of definition share one
 * shape: the always-present system layers served by Martin from `gis.*`, and the
 * user's drawn layers (`gis.layers` rows of kind `drawn`), which all live in the
 * single `layer_features` source and are told apart by a `layer_id` filter. Each
 * definition is declarative and compiles to one or more MapLibre layers via
 * {@link compileLayers}; visibility and opacity are applied imperatively so
 * dragging the opacity slider never rebuilds the style. Colors are design-system
 * tokens (docs/06 §2) resolved at compile time, so light/dark themes are honored;
 * a drawn layer may override its color from its stored style. Incident markers
 * use the fixed severity-token scale and server-provided cluster/status
 * properties.
 */

export type LayerGroup = 'operational' | 'boundaries' | 'infrastructure' | 'risk' | 'mine';

/** Panel + on-map z-order (first = bottom). Polygons under points under drawn. */
export const LAYER_GROUP_ORDER: readonly LayerGroup[] = [
  'boundaries',
  'infrastructure',
  'risk',
  'mine',
  'operational',
] as const;

/** Operational data is the primary panel group even though it renders last on
 * the map so incident markers stay above polygon and infrastructure layers. */
export const PANEL_GROUP_ORDER: readonly LayerGroup[] = [
  'operational',
  'boundaries',
  'infrastructure',
  'risk',
  'mine',
] as const;

export type LayerKind = 'fill' | 'circle' | 'mixed' | 'incident';

export interface LegendItem {
  shape: 'fill' | 'line' | 'circle' | 'active' | 'diamond' | 'square' | 'cross';
  /** Design-token variable name (e.g. `--sev-3`). */
  token: string;
  /** i18n key in the `map` namespace. */
  labelKey: string;
}

export interface MapLayerDef {
  /** Stable id; also the base of every compiled MapLibre layer id. */
  id: string;
  /** Martin source id (auto-published from schema `gis`). */
  source: string;
  /** Vector-tile layer name inside the source (Martin names it after the source). */
  sourceLayer: string;
  group: LayerGroup;
  /** i18n key in the `map` namespace (system layers). */
  titleKey?: string;
  /** Literal title — drawn layers are named by their author. */
  title?: string;
  kind: LayerKind;
  /** Design-token variable for the primary color. */
  colorToken: string;
  /** Literal color from the layer's stored style, overriding `colorToken`. */
  color?: string;
  /** Narrows the layer to a subset of its source — drawn layers share one. */
  filter?: ExpressionSpecification;
  legend: LegendItem[];
  defaultVisible: boolean;
  minzoom?: number;
  /** Override base fill-opacity (fill/mixed layers). */
  fillOpacity?: number;
  /** The `gis.layers` row behind a drawn layer; absent for system layers. */
  drawn?: GisLayerDto;
  /** The `gis.layers` row behind an imported layer (task 2.8). */
  imported?: GisLayerDto;
  /** Martin source this layer's tiles come from, when it differs from the MapLibre
   *  source id — imported layers share one function source but each needs its own
   *  MapLibre source (their tile URLs differ by `?layer=`). */
  tileSource?: string;
  /** Query string appended to the tile URL (without `?`). */
  tileQuery?: string;
}

/** The registry row behind a layer, whichever kind it is. */
export function registryLayer(def: MapLayerDef): GisLayerDto | undefined {
  return def.drawn ?? def.imported;
}

export interface LayerState {
  visible: boolean;
  opacity: number;
}

// Base paint intensities, multiplied by the user's opacity (0..1).
const FILL_BASE = 0.25;
const OUTLINE_BASE = 0.9;
const CIRCLE_BASE = 0.85;
const LINE_BASE = 0.85;
const STROKE_BASE = 1;

export const INCIDENTS_LAYER_ID = 'incidents';
export const INCIDENT_CLUSTERS_LAYER_ID = `${INCIDENTS_LAYER_ID}-clusters`;
export const INCIDENT_CLUSTER_COUNT_LAYER_ID = `${INCIDENTS_LAYER_ID}-cluster-count`;
export const INCIDENT_PULSE_LAYER_ID = `${INCIDENTS_LAYER_ID}-active-pulse`;

/** Paint frame for the active-incident halo. `progress` is normalized 0..1. */
export function incidentPulseFrame(progress: number): { radius: number; opacity: number } {
  const phase = Math.max(0, Math.min(1, progress));
  return { radius: 9 + phase * 9, opacity: (1 - phase) * 0.28 };
}

const INCIDENT_LEGEND: LegendItem[] = [1, 2, 3, 4, 5].map((level) => ({
  shape: 'circle',
  token: `--sev-${level}`,
  labelKey: `legend.severity${level}`,
}));

INCIDENT_LEGEND.push(
  { shape: 'circle', token: '--text-muted', labelKey: 'legend.statusReported' },
  { shape: 'active', token: '--text-muted', labelKey: 'legend.statusActive' },
  { shape: 'diamond', token: '--text-muted', labelKey: 'legend.statusLocalized' },
  { shape: 'square', token: '--text-muted', labelKey: 'legend.statusEliminated' },
  { shape: 'cross', token: '--text-muted', labelKey: 'legend.statusClosed' },
);

export const SYSTEM_LAYERS: readonly MapLayerDef[] = [
  {
    id: INCIDENTS_LAYER_ID,
    source: 'incidents_mvt',
    sourceLayer: 'incidents',
    group: 'operational',
    titleKey: 'layers.incidents',
    kind: 'incident',
    colorToken: '--sev-3',
    legend: INCIDENT_LEGEND,
    defaultVisible: true,
  },
  {
    id: 'admin_units',
    source: 'admin_units',
    sourceLayer: 'admin_units',
    group: 'boundaries',
    titleKey: 'layers.adminUnits',
    kind: 'fill',
    colorToken: '--primary',
    fillOpacity: 0.04,
    legend: [{ shape: 'line', token: '--primary', labelKey: 'legend.adminUnits' }],
    defaultVisible: true,
  },
  {
    id: 'facilities',
    source: 'facilities',
    sourceLayer: 'facilities',
    group: 'infrastructure',
    titleKey: 'layers.facilities',
    kind: 'circle',
    colorToken: '--info',
    legend: [{ shape: 'circle', token: '--info', labelKey: 'legend.facilities' }],
    defaultVisible: true,
  },
  {
    id: 'risk_zones',
    source: 'risk_zones',
    sourceLayer: 'risk_zones',
    group: 'risk',
    titleKey: 'layers.riskZones',
    kind: 'fill',
    colorToken: '--sev-3',
    fillOpacity: 0.3,
    legend: [{ shape: 'fill', token: '--sev-3', labelKey: 'legend.riskZones' }],
    defaultVisible: false,
  },
];

/**
 * Martin source holding every drawn layer's features (`gis.layer_features_mvt`,
 * migration 0021). It is a *function* source rather than the plain table: Martin
 * caches table tiles by (source, z, x, y) alone, so a freshly drawn feature would
 * keep hitting a stale tile. A function source's cache key includes its query
 * params, so bumping `?v=` after a write always returns fresh geometry.
 */
export const DRAWN_SOURCE = 'layer_features_mvt';
/** The MVT layer name inside that source (what `ST_AsMVT` names it). */
export const DRAWN_SOURCE_LAYER = 'layer_features';
/** Prefix of a drawn layer's def id, so it never collides with a system layer. */
export const DRAWN_PREFIX = 'drawn:';

/**
 * Martin function source serving every imported layer (`gis.imported_mvt`,
 * migration 0023; task 2.8). A physical table created after Martin booted is not in
 * its table catalog, so an imported layer would not be servable until the tile
 * server restarted. The function resolves the table from the registry by
 * `?layer=<id>` instead, which also means each imported layer needs its own
 * MapLibre source (their tile URLs differ only by that query).
 */
export const IMPORTED_SOURCE = 'imported_mvt';
/** The MVT layer name inside that source. */
export const IMPORTED_SOURCE_LAYER = 'imported';
/** Prefix of an imported layer's def id. */
export const IMPORTED_PREFIX = 'imported:';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The drawn layer a def belongs to, or `null` for system layers. */
export function drawnLayerIdOf(def: MapLayerDef): string | null {
  return def.drawn?.id ?? null;
}

/**
 * Compile the user's drawn layers (`GET /gis/layers`) into map definitions. They
 * all read the same `layer_features` source, so each is narrowed by its
 * `layer_id`; the color comes from the layer's stored style when it is a valid
 * hex, otherwise from the design token.
 */
export function drawnLayerDefs(layers: readonly GisLayerDto[]): MapLayerDef[] {
  return layers
    .filter((layer) => layer.kind === 'drawn')
    .map((layer) => {
      const styleColor = layer.style['color'];
      const color =
        typeof styleColor === 'string' && HEX_COLOR.test(styleColor) ? styleColor : undefined;
      const filter: ExpressionSpecification = ['==', ['get', 'layer_id'], layer.id];
      return {
        id: `${DRAWN_PREFIX}${layer.id}`,
        source: DRAWN_SOURCE,
        sourceLayer: DRAWN_SOURCE_LAYER,
        group: 'mine' as const,
        title: layer.title,
        kind: 'mixed' as const,
        colorToken: '--success',
        ...(color ? { color } : {}),
        filter,
        legend: [],
        defaultVisible: true,
        ...(layer.minZoom !== null ? { minzoom: layer.minZoom } : {}),
        drawn: layer,
      };
    });
}

/** Paint kind an import's auto style asks for (worker: `autoStyle`). */
function importedKind(style: Record<string, unknown>): LayerKind {
  const kind = style['kind'];
  return kind === 'circle' || kind === 'fill' || kind === 'mixed' ? kind : 'mixed';
}

/**
 * Compile the user's imported layers (`GET /gis/layers`, kind `imported`). Each one
 * is its own MapLibre source: they share the `imported_mvt` function source but
 * differ by the `?layer=` it resolves the physical table from.
 */
export function importedLayerDefs(layers: readonly GisLayerDto[]): MapLayerDef[] {
  return layers
    .filter((layer) => layer.kind === 'imported')
    .map((layer) => {
      const styleColor = layer.style['color'];
      const color =
        typeof styleColor === 'string' && HEX_COLOR.test(styleColor) ? styleColor : undefined;
      return {
        id: `${IMPORTED_PREFIX}${layer.id}`,
        source: `${IMPORTED_PREFIX}${layer.id}`,
        tileSource: IMPORTED_SOURCE,
        tileQuery: `layer=${layer.id}`,
        sourceLayer: IMPORTED_SOURCE_LAYER,
        group: 'mine' as const,
        title: layer.title,
        kind: importedKind(layer.style),
        colorToken: '--info',
        ...(color ? { color } : {}),
        legend: [],
        defaultVisible: true,
        ...(layer.minZoom !== null ? { minzoom: layer.minZoom } : {}),
        imported: layer,
      };
    });
}

/** The default per-layer state map (used to seed the page). */
export function defaultLayerStates(
  defs: readonly MapLayerDef[] = SYSTEM_LAYERS,
): Record<string, LayerState> {
  const states: Record<string, LayerState> = {};
  for (const def of defs) states[def.id] = { visible: def.defaultVisible, opacity: 1 };
  return states;
}

/** The state a def is rendered with when the page has no entry for it yet
 *  (drawn layers appear after their API fetch resolves). */
export function layerState(states: Record<string, LayerState>, def: MapLayerDef): LayerState {
  return states[def.id] ?? { visible: def.defaultVisible, opacity: 1 };
}

/** The MapLibre layer ids a definition compiles to (for visibility toggling). */
export function sublayerIds(def: MapLayerDef): string[] {
  switch (def.kind) {
    case 'fill':
      return [def.id, `${def.id}-outline`];
    case 'circle':
      return [def.id];
    case 'mixed':
      return [`${def.id}-fill`, `${def.id}-line`, `${def.id}-point`];
    case 'incident':
      return [
        INCIDENT_CLUSTERS_LAYER_ID,
        INCIDENT_CLUSTER_COUNT_LAYER_ID,
        INCIDENT_PULSE_LAYER_ID,
        INCIDENTS_LAYER_ID,
      ];
  }
}

interface OpacityTarget {
  layerId: string;
  prop: string;
  base: number;
}

/** The paint props that carry opacity for a definition, with their base values. */
export function opacityTargets(def: MapLayerDef): OpacityTarget[] {
  switch (def.kind) {
    case 'fill':
      return [
        { layerId: def.id, prop: 'fill-opacity', base: def.fillOpacity ?? FILL_BASE },
        { layerId: `${def.id}-outline`, prop: 'line-opacity', base: OUTLINE_BASE },
      ];
    case 'circle':
      return [
        { layerId: def.id, prop: 'circle-opacity', base: CIRCLE_BASE },
        { layerId: def.id, prop: 'circle-stroke-opacity', base: STROKE_BASE },
      ];
    case 'mixed':
      return [
        { layerId: `${def.id}-fill`, prop: 'fill-opacity', base: FILL_BASE },
        { layerId: `${def.id}-line`, prop: 'line-opacity', base: LINE_BASE },
        { layerId: `${def.id}-point`, prop: 'circle-opacity', base: CIRCLE_BASE },
        { layerId: `${def.id}-point`, prop: 'circle-stroke-opacity', base: STROKE_BASE },
      ];
    case 'incident':
      return [
        {
          layerId: INCIDENT_CLUSTERS_LAYER_ID,
          prop: 'circle-opacity',
          base: 0.92,
        },
        {
          layerId: INCIDENT_CLUSTERS_LAYER_ID,
          prop: 'circle-stroke-opacity',
          base: STROKE_BASE,
        },
        {
          layerId: INCIDENT_CLUSTER_COUNT_LAYER_ID,
          prop: 'icon-opacity',
          base: 1,
        },
        { layerId: INCIDENT_PULSE_LAYER_ID, prop: 'circle-opacity', base: 0.25 },
        { layerId: INCIDENTS_LAYER_ID, prop: 'icon-opacity', base: 0.95 },
      ];
  }
}

/**
 * The MapLibre filter a definition renders with. `hiddenFeatureId` removes the
 * feature currently open in the geometry editor, which draws it itself — without
 * this it would show twice (stale tile copy under the editable one).
 */
export function layerFilter(
  def: MapLayerDef,
  hiddenFeatureId?: string | null,
): FilterSpecification | null {
  const clauses: ExpressionSpecification[] = [];
  if (def.filter) clauses.push(def.filter);
  if (hiddenFeatureId && def.drawn) clauses.push(['!=', ['get', 'id'], hiddenFeatureId]);
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0]!;
  return ['all', ...clauses];
}

/** Imperatively re-apply a drawn layer's filter (no style rebuild). System
 *  layers are skipped: their filters are structural (clusters vs. markers). */
export function applyFilter(map: MlMap, def: MapLayerDef, hiddenFeatureId?: string | null): void {
  if (!def.drawn) return;
  const filter = layerFilter(def, hiddenFeatureId);
  for (const id of sublayerIds(def)) {
    if (map.getLayer(id)) map.setFilter(id, filter);
  }
}

/** Compile a definition to MapLibre layer specs for the given theme + state. */
export function compileLayers(
  def: MapLayerDef,
  token: TokenResolver,
  state: LayerState,
  hiddenFeatureId?: string | null,
): LayerSpecification[] {
  const visibility: 'visible' | 'none' = state.visible ? 'visible' : 'none';
  const op = state.opacity;
  const color = def.color ?? token(def.colorToken);
  const stroke = token('--surface');
  const shared = { source: def.source, 'source-layer': def.sourceLayer } as const;
  const featureFilter = layerFilter(def, hiddenFeatureId);
  const scoped = featureFilter ? { filter: featureFilter } : {};
  const withZoom = <T extends object>(spec: T): T =>
    def.minzoom === undefined ? spec : { ...spec, minzoom: def.minzoom };

  switch (def.kind) {
    case 'fill':
      return [
        withZoom({
          id: def.id,
          type: 'fill',
          ...shared,
          ...scoped,
          layout: { visibility },
          paint: { 'fill-color': color, 'fill-opacity': (def.fillOpacity ?? FILL_BASE) * op },
        }),
        withZoom({
          id: `${def.id}-outline`,
          type: 'line',
          ...shared,
          ...scoped,
          layout: { visibility, 'line-join': 'round' },
          paint: { 'line-color': color, 'line-width': 1.4, 'line-opacity': OUTLINE_BASE * op },
        }),
      ];
    case 'circle':
      return [
        withZoom({
          id: def.id,
          type: 'circle',
          ...shared,
          ...scoped,
          layout: { visibility },
          paint: {
            'circle-radius': 5,
            'circle-color': color,
            'circle-opacity': CIRCLE_BASE * op,
            'circle-stroke-color': stroke,
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': STROKE_BASE * op,
          },
        }),
      ];
    case 'mixed':
      // Beyond the def's own filter MapLibre draws only geometry-compatible
      // features per layer type (fill→polygons, line→lines+polygon rings,
      // circle→points), so one def covers a mixed-geometry layer.
      return [
        withZoom({
          id: `${def.id}-fill`,
          type: 'fill',
          ...shared,
          ...scoped,
          layout: { visibility },
          paint: { 'fill-color': color, 'fill-opacity': FILL_BASE * op },
        }),
        withZoom({
          id: `${def.id}-line`,
          type: 'line',
          ...shared,
          ...scoped,
          layout: { visibility, 'line-join': 'round' },
          paint: { 'line-color': color, 'line-width': 1.6, 'line-opacity': LINE_BASE * op },
        }),
        withZoom({
          id: `${def.id}-point`,
          type: 'circle',
          ...shared,
          ...scoped,
          layout: { visibility },
          paint: {
            'circle-radius': 4,
            'circle-color': color,
            'circle-opacity': CIRCLE_BASE * op,
            'circle-stroke-color': stroke,
            'circle-stroke-width': 1,
            'circle-stroke-opacity': STROKE_BASE * op,
          },
        }),
      ];
    case 'incident': {
      const severityColor: ExpressionSpecification = [
        'match',
        ['get', 'severity'],
        1,
        token('--sev-1'),
        2,
        token('--sev-2'),
        3,
        token('--sev-3'),
        4,
        token('--sev-4'),
        5,
        token('--sev-5'),
        token('--text-muted'),
      ];
      const clusterFilter: FilterSpecification = ['>', ['get', 'cluster_count'], 1];
      const markerFilter: FilterSpecification = ['<=', ['get', 'cluster_count'], 1];
      return [
        {
          id: INCIDENT_CLUSTERS_LAYER_ID,
          type: 'circle',
          ...shared,
          filter: clusterFilter,
          layout: { visibility },
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['get', 'cluster_count'],
              2,
              12,
              20,
              18,
              100,
              24,
            ],
            'circle-color': severityColor,
            'circle-opacity': 0.92 * op,
            'circle-stroke-color': stroke,
            'circle-stroke-width': 2,
            'circle-stroke-opacity': STROKE_BASE * op,
          },
        },
        {
          id: INCIDENT_CLUSTER_COUNT_LAYER_ID,
          type: 'symbol',
          ...shared,
          filter: clusterFilter,
          layout: {
            visibility,
            'icon-image': [
              'concat',
              'incident-cluster-count-',
              ['to-string', ['get', 'cluster_count']],
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: { 'icon-opacity': op },
        },
        {
          id: INCIDENT_PULSE_LAYER_ID,
          type: 'circle',
          ...shared,
          filter: ['all', markerFilter, ['==', ['get', 'status'], 'active']],
          layout: { visibility },
          paint: {
            'circle-radius': 10,
            'circle-color': severityColor,
            'circle-opacity': 0.25 * op,
          },
        },
        {
          id: INCIDENTS_LAYER_ID,
          type: 'symbol',
          ...shared,
          filter: markerFilter,
          layout: {
            visibility,
            'icon-image': [
              'concat',
              'incident-status-',
              ['get', 'status'],
              '-sev-',
              ['to-string', ['get', 'severity']],
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            'icon-opacity': 0.95 * op,
          },
        },
      ];
    }
  }
}

/** All layers (system + drawn) compiled in group/z order, filtered to available
 *  sources. */
export function compileAllLayers(
  token: TokenResolver,
  states: Record<string, LayerState>,
  availableSources: ReadonlySet<string> | null,
  drawnDefs: readonly MapLayerDef[] = [],
  hiddenFeatureId?: string | null,
): LayerSpecification[] {
  const defs = orderedLayers(drawnDefs).filter(
    (def) => !availableSources || availableSources.has(def.tileSource ?? def.source),
  );
  return defs.flatMap((def) => compileLayers(def, token, layerState(states, def), hiddenFeatureId));
}

/** System + drawn layers sorted by group z-order (bottom → top). */
export function orderedLayers(drawnDefs: readonly MapLayerDef[] = []): MapLayerDef[] {
  return [...SYSTEM_LAYERS, ...drawnDefs].sort(
    (a, b) => LAYER_GROUP_ORDER.indexOf(a.group) - LAYER_GROUP_ORDER.indexOf(b.group),
  );
}

/** Imperatively apply a layer's visibility to an initialized map (no rebuild). */
export function applyVisibility(map: MlMap, def: MapLayerDef, visible: boolean): void {
  for (const id of sublayerIds(def)) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

/** Imperatively apply a layer's opacity to an initialized map (no rebuild). */
export function applyOpacity(map: MlMap, def: MapLayerDef, opacity: number): void {
  for (const target of opacityTargets(def)) {
    if (map.getLayer(target.layerId)) {
      map.setPaintProperty(target.layerId, target.prop, target.base * opacity);
    }
  }
}
