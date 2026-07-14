import type { MapGeoJSONFeature } from 'maplibre-gl';
import {
  DRAWN_SOURCE_LAYER,
  INCIDENT_CLUSTERS_LAYER_ID,
  INCIDENT_CLUSTER_COUNT_LAYER_ID,
  INCIDENT_PULSE_LAYER_ID,
  sublayerIds,
  type MapLayerDef,
} from './layers';

/**
 * Object inspector (docs/modules/10 §4). Turns raw vector-tile hits into the
 * peek-card model the UI renders: one entry per real object, clusters dropped,
 * jsonb attribute columns parsed back from the strings MVT can carry.
 */

export type InspectKind = 'incident' | 'drawn' | 'facility' | 'admin_unit' | 'risk_zone';

export interface InspectedFeature {
  kind: InspectKind;
  /** Domain id — the incident id, drawn-feature id or table row id. */
  id: string;
  /** Owning drawn layer (`kind === 'drawn'` only). */
  layerId?: string;
  /** Row/header label. */
  title: string;
  /** Tile attributes; jsonb columns are already parsed. */
  props: Record<string, unknown>;
}

/** Cap on a rubber-band selection, so a country-wide box can't stall the panel. */
export const MAX_SELECTION = 100;

/**
 * Which object a click is "about" when several overlap. Mirrors the map's z-order
 * (docs/modules/10 §4): the admin boundary under the cursor is always a hit, but
 * the incident or the drawn object on top of it is what the user aimed at.
 */
const KIND_PRIORITY: Record<InspectKind, number> = {
  incident: 0,
  drawn: 1,
  facility: 2,
  risk_zone: 3,
  admin_unit: 4,
};

const KIND_BY_SOURCE_LAYER: Record<string, InspectKind> = {
  incidents: 'incident',
  [DRAWN_SOURCE_LAYER]: 'drawn',
  facilities: 'facility',
  admin_units: 'admin_unit',
  risk_zones: 'risk_zone',
};

/** MVT properties are scalars, so Martin serializes jsonb columns as text. */
function parseJsonProps(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** The MapLibre layer ids the inspector queries, bottom-up. Cluster bubbles are
 *  excluded: clicking one zooms in instead of opening a card. */
export function inspectableLayerIds(
  defs: readonly MapLayerDef[],
  drawnDefs: readonly MapLayerDef[] = [],
): string[] {
  const skip = new Set([
    INCIDENT_CLUSTERS_LAYER_ID,
    INCIDENT_CLUSTER_COUNT_LAYER_ID,
    INCIDENT_PULSE_LAYER_ID,
  ]);
  return [...defs, ...drawnDefs].flatMap((def) => sublayerIds(def).filter((id) => !skip.has(id)));
}

/**
 * Map one tile hit to an inspector entry. `layerTitles` names the drawn layers
 * (id → title). Returns `null` for hits that are not objects in their own right
 * (incident clusters) or that lack an id.
 */
export function toInspected(
  feature: MapGeoJSONFeature,
  layerTitles: ReadonlyMap<string, string>,
): InspectedFeature | null {
  const kind = KIND_BY_SOURCE_LAYER[feature.sourceLayer ?? ''];
  if (!kind) return null;
  const props = feature.properties as Record<string, unknown>;

  if (kind === 'incident') {
    if (props['is_cluster'] === true || Number(props['cluster_count'] ?? 1) > 1) return null;
    const id = asString(props['feature_id']);
    if (!id) return null;
    return { kind, id, title: asString(props['number']), props };
  }

  if (kind === 'drawn') {
    const id = asString(props['id']);
    const layerId = asString(props['layer_id']);
    if (!id || !layerId) return null;
    return {
      kind,
      id,
      layerId,
      title: layerTitles.get(layerId) ?? '',
      props: parseJsonProps(props['props']),
    };
  }

  const id = asString(props['id']);
  if (!id) return null;
  const title = asString(props['name_ru'] || props['name'] || props['code']);
  return { kind, id, title, props: { ...props, ...parseJsonProps(props['attrs']) } };
}

/**
 * Tile hits → deduplicated inspector entries, topmost object first. A feature can
 * hit several sublayers of one def (a polygon's fill and its outline), and a click
 * anywhere on the map also hits the administrative unit under it — so the entries
 * are ordered by {@link KIND_PRIORITY} and the panel opens the first one.
 */
export function inspectFeatures(
  features: readonly MapGeoJSONFeature[],
  layerTitles: ReadonlyMap<string, string>,
  limit: number = MAX_SELECTION,
): InspectedFeature[] {
  const seen = new Set<string>();
  const out: InspectedFeature[] = [];
  for (const feature of features) {
    const inspected = toInspected(feature, layerTitles);
    if (!inspected) continue;
    const key = `${inspected.kind}:${inspected.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(inspected);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}
