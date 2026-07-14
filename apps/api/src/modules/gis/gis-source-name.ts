import { gisLayers } from '@cuks/db';

type GisLayer = typeof gisLayers.$inferSelect;

/** The `gis` table/view a drawn layer publishes through — `gis.v_<slug>`. */
export function drawnViewName(layer: Pick<GisLayer, 'slug'>): string {
  return `v_${layer.slug.replace(/-/g, '_')}`.slice(0, 63);
}

/**
 * The name GeoServer publishes for a layer (task 2.9), or `null` for a layer that
 * has no publishable table (a system layer). Shared by the publication service and
 * the delete path so an unpublish always targets the same object a publish created.
 */
export function publishedSourceName(layer: GisLayer): string | null {
  if (layer.kind === 'imported') return layer.tableName;
  if (layer.kind === 'drawn') return drawnViewName(layer);
  return null;
}
