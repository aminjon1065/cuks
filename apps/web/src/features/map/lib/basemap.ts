import { DARK, layers as protomapsLayers, LIGHT } from '@protomaps/basemaps';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { BASEMAP_SOURCE, tileUrl, type TokenResolver } from './map-config';
import {
  compileAllLayers,
  DRAWN_SOURCE,
  SYSTEM_LAYERS,
  type LayerState,
  type MapLayerDef,
} from './layers';

/**
 * MapLibre style builder (docs/modules/10 §4). Two flavors — `light`/`dark` —
 * mirror the app theme. The style is always self-contained (offline invariant,
 * CLAUDE.md §2): no external tiles, fonts, or sprites.
 *
 * - Neutral basemap (dev / no PMTiles): a token-colored background; the `gis.*`
 *   vector layers render on top. The map is never blank.
 * - Protomaps basemap (prod, once `region.pmtiles` is built): cartographic
 *   light/dark layers from `@protomaps/basemaps`, served through Martin. Label
 *   glyphs are self-hosted at `/basemap-fonts` (served alongside the basemap;
 *   see `infra/scripts/build-basemap.sh`).
 */

export type BasemapFlavor = 'light' | 'dark';

/** Basemap selection: an explicit flavor, or `auto` to follow the app theme. */
export type BasemapMode = 'auto' | 'light' | 'dark';

/** Map a switcher mode to the MapView `basemapOverride` prop (`null` = follow). */
export function modeToOverride(mode: BasemapMode): BasemapFlavor | null {
  return mode === 'auto' ? null : mode;
}

/** MapLibre source key for the Protomaps basemap (its layers reference this id). */
const PROTOMAPS_SOURCE = 'protomaps';

/** Self-hosted glyphs for Protomaps labels (prod-only; dormant on the neutral
 *  basemap, which has no text layers). */
const GLYPHS_URL = '/basemap-fonts/{fontstack}/{range}.pbf';

export interface BuildStyleOptions {
  flavor: BasemapFlavor;
  token: TokenResolver;
  states: Record<string, LayerState>;
  /** Martin source ids present in the catalog; `null` = assume all available. */
  availableSources: ReadonlySet<string> | null;
  /** Query string for the filtered incident MVT source (without `?`/token). */
  incidentTileQuery?: string;
  /** The user's drawn layers (task 2.7); all share the `layer_features` source. */
  drawnDefs?: readonly MapLayerDef[];
  /** Cache-buster for the drawn source, bumped after every feature write. */
  drawnTileQuery?: string;
  /** Feature open in the geometry editor — hidden from tiles while it is edited. */
  hiddenFeatureId?: string | null;
}

/** The unique Martin sources referenced by the available layers. */
function gisSources(
  availableSources: ReadonlySet<string> | null,
  drawnDefs: readonly MapLayerDef[],
): string[] {
  const sources = new Set<string>();
  for (const def of [...SYSTEM_LAYERS, ...drawnDefs]) {
    if (!availableSources || availableSources.has(def.source)) sources.add(def.source);
  }
  return [...sources];
}

export function hasBasemap(availableSources: ReadonlySet<string> | null): boolean {
  return availableSources?.has(BASEMAP_SOURCE) ?? false;
}

export function buildStyle(opts: BuildStyleOptions): StyleSpecification {
  const { flavor, token, states, availableSources } = opts;
  const drawnDefs = opts.drawnDefs ?? [];
  const basemap = hasBasemap(availableSources);

  const sources: StyleSpecification['sources'] = {};
  for (const source of gisSources(availableSources, drawnDefs)) {
    const query =
      source === 'incidents_mvt'
        ? (opts.incidentTileQuery ?? '')
        : source === DRAWN_SOURCE
          ? (opts.drawnTileQuery ?? '')
          : '';
    sources[source] = { type: 'vector', tiles: [tileUrl(source, query)], minzoom: 0, maxzoom: 18 };
  }
  if (basemap) {
    sources[PROTOMAPS_SOURCE] = {
      type: 'vector',
      tiles: [tileUrl(BASEMAP_SOURCE)],
      minzoom: 0,
      maxzoom: 15,
      attribution: '© OpenStreetMap',
    };
  }

  // The Protomaps theme already emits its own `background` layer, so only add a
  // neutral one when there is no basemap — otherwise two layers share the id
  // `background` and MapLibre rejects the whole style (validation error).
  const neutralBackground: LayerSpecification = {
    id: 'background',
    type: 'background',
    paint: { 'background-color': token('--background') },
  };

  const basemapLayers: LayerSpecification[] = basemap
    ? protomapsLayers(PROTOMAPS_SOURCE, flavor === 'dark' ? DARK : LIGHT, { lang: 'ru' })
    : [neutralBackground];

  const style: StyleSpecification = {
    version: 8,
    sources,
    layers: [
      ...basemapLayers,
      ...compileAllLayers(token, states, availableSources, drawnDefs, opts.hiddenFeatureId),
    ],
  };
  if (basemap) style.glyphs = GLYPHS_URL;
  return style;
}
