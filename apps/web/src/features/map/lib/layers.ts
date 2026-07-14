import type { LayerSpecification, Map as MlMap } from 'maplibre-gl';
import type { TokenResolver } from './map-config';

/**
 * System layer registry (docs/modules/10 §3/§4). These are the always-present
 * `gis.*` layers served by Martin. Each definition is declarative and compiles
 * to one or more MapLibre layers via {@link compileLayers}; visibility and
 * opacity are applied imperatively so dragging the opacity slider never rebuilds
 * the style. Colors are design-system tokens (docs/06 §2) resolved at compile
 * time, so light/dark themes are honored. Data-driven styling by severity/level
 * lands with the incidents layer (task 2.4).
 */

export type LayerGroup = 'boundaries' | 'infrastructure' | 'risk' | 'mine';

/** Panel + on-map z-order (first = bottom). Polygons under points under drawn. */
export const LAYER_GROUP_ORDER: readonly LayerGroup[] = [
  'boundaries',
  'infrastructure',
  'risk',
  'mine',
] as const;

export type LayerKind = 'fill' | 'circle' | 'mixed';

export interface LegendItem {
  shape: 'fill' | 'line' | 'circle';
  /** Design-token variable name (e.g. `--sev-3`). */
  token: string;
  /** i18n key in the `map` namespace. */
  labelKey: string;
}

export interface SystemLayerDef {
  /** Stable id; also the base of every compiled MapLibre layer id. */
  id: string;
  /** Martin source id (auto-published from schema `gis`). */
  source: string;
  /** Vector-tile layer name inside the source (Martin names it after the source). */
  sourceLayer: string;
  group: LayerGroup;
  /** i18n key in the `map` namespace. */
  titleKey: string;
  kind: LayerKind;
  /** Design-token variable for the primary color. */
  colorToken: string;
  legend: LegendItem[];
  defaultVisible: boolean;
  minzoom?: number;
  /** Override base fill-opacity (fill/mixed layers). */
  fillOpacity?: number;
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

export const SYSTEM_LAYERS: readonly SystemLayerDef[] = [
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
  {
    id: 'layer_features',
    source: 'layer_features',
    sourceLayer: 'layer_features',
    group: 'mine',
    titleKey: 'layers.drawn',
    kind: 'mixed',
    colorToken: '--success',
    legend: [{ shape: 'fill', token: '--success', labelKey: 'legend.drawn' }],
    defaultVisible: false,
  },
];

/** The default per-layer state map (used to seed the page). */
export function defaultLayerStates(
  defs: readonly SystemLayerDef[] = SYSTEM_LAYERS,
): Record<string, LayerState> {
  const states: Record<string, LayerState> = {};
  for (const def of defs) states[def.id] = { visible: def.defaultVisible, opacity: 1 };
  return states;
}

/** The MapLibre layer ids a definition compiles to (for visibility toggling). */
export function sublayerIds(def: SystemLayerDef): string[] {
  switch (def.kind) {
    case 'fill':
      return [def.id, `${def.id}-outline`];
    case 'circle':
      return [def.id];
    case 'mixed':
      return [`${def.id}-fill`, `${def.id}-line`, `${def.id}-point`];
  }
}

interface OpacityTarget {
  layerId: string;
  prop: string;
  base: number;
}

/** The paint props that carry opacity for a definition, with their base values. */
export function opacityTargets(def: SystemLayerDef): OpacityTarget[] {
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
  }
}

/** Compile a definition to MapLibre layer specs for the given theme + state. */
export function compileLayers(
  def: SystemLayerDef,
  token: TokenResolver,
  state: LayerState,
): LayerSpecification[] {
  const visibility: 'visible' | 'none' = state.visible ? 'visible' : 'none';
  const op = state.opacity;
  const color = token(def.colorToken);
  const stroke = token('--surface');
  const shared = { source: def.source, 'source-layer': def.sourceLayer } as const;
  const withZoom = <T extends object>(spec: T): T =>
    def.minzoom === undefined ? spec : { ...spec, minzoom: def.minzoom };

  switch (def.kind) {
    case 'fill':
      return [
        withZoom({
          id: def.id,
          type: 'fill',
          ...shared,
          layout: { visibility },
          paint: { 'fill-color': color, 'fill-opacity': (def.fillOpacity ?? FILL_BASE) * op },
        }),
        withZoom({
          id: `${def.id}-outline`,
          type: 'line',
          ...shared,
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
      // No filters: MapLibre draws only geometry-compatible features per layer
      // type (fill→polygons, line→lines+polygon rings, circle→points).
      return [
        withZoom({
          id: `${def.id}-fill`,
          type: 'fill',
          ...shared,
          layout: { visibility },
          paint: { 'fill-color': color, 'fill-opacity': FILL_BASE * op },
        }),
        withZoom({
          id: `${def.id}-line`,
          type: 'line',
          ...shared,
          layout: { visibility, 'line-join': 'round' },
          paint: { 'line-color': color, 'line-width': 1.6, 'line-opacity': LINE_BASE * op },
        }),
        withZoom({
          id: `${def.id}-point`,
          type: 'circle',
          ...shared,
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
  }
}

/** All system layers compiled in group/z order, filtered to available sources. */
export function compileAllLayers(
  token: TokenResolver,
  states: Record<string, LayerState>,
  availableSources: ReadonlySet<string> | null,
): LayerSpecification[] {
  const defs = orderedLayers().filter(
    (def) => !availableSources || availableSources.has(def.source),
  );
  return defs.flatMap((def) =>
    compileLayers(def, token, states[def.id] ?? { visible: def.defaultVisible, opacity: 1 }),
  );
}

/** System layers sorted by group z-order (bottom → top). */
export function orderedLayers(): SystemLayerDef[] {
  return [...SYSTEM_LAYERS].sort(
    (a, b) => LAYER_GROUP_ORDER.indexOf(a.group) - LAYER_GROUP_ORDER.indexOf(b.group),
  );
}

/** Imperatively apply a layer's visibility to an initialized map (no rebuild). */
export function applyVisibility(map: MlMap, def: SystemLayerDef, visible: boolean): void {
  for (const id of sublayerIds(def)) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

/** Imperatively apply a layer's opacity to an initialized map (no rebuild). */
export function applyOpacity(map: MlMap, def: SystemLayerDef, opacity: number): void {
  for (const target of opacityTargets(def)) {
    if (map.getLayer(target.layerId)) {
      map.setPaintProperty(target.layerId, target.prop, target.base * opacity);
    }
  }
}
