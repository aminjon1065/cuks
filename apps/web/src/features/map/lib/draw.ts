import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type HexColor,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { Map as MlMap } from 'maplibre-gl';
import type { GeoJsonGeometry } from '@cuks/shared';

/**
 * Geometry drawing and editing (docs/modules/10 §4, task 2.7). Terra-draw owns
 * the interaction; the drawn geometry is persisted through the features API and
 * comes back as a vector tile, so terra-draw's own store only ever holds what is
 * being drawn or edited right now.
 */

export type DrawTool = 'none' | 'select' | 'point' | 'line' | 'polygon';

/** Terra-draw mode names. Also the `mode` property a feature carries in its
 *  store — it decides which mode may edit the feature. */
export type TerraModeName = 'select' | 'point' | 'linestring' | 'polygon' | 'static';

const MODE_BY_TOOL: Record<Exclude<DrawTool, 'none'>, TerraModeName> = {
  select: 'select',
  point: 'point',
  line: 'linestring',
  polygon: 'polygon',
};

export function terraMode(tool: DrawTool): TerraModeName {
  return tool === 'none' ? 'static' : MODE_BY_TOOL[tool];
}

/** Drawing tools a layer's declared geometry type accepts. The server enforces
 *  the same rule (`gis.feature.geometry_mismatch`); this only hides what would
 *  be rejected. */
export function toolsFor(geometryType: string | null): DrawTool[] {
  switch (geometryType) {
    case 'Point':
      return ['point'];
    case 'LineString':
      return ['line'];
    case 'Polygon':
      return ['polygon'];
    default:
      return ['point', 'line', 'polygon'];
  }
}

/** The single-part geometries terra-draw can edit (its store holds no Multi*). */
export type EditableGeometry = Extract<
  GeoJsonGeometry,
  { type: 'Point' | 'LineString' | 'Polygon' }
>;

/** The stored geometry, if terra-draw can edit it in place. Multi-part geometries
 *  (imported data) have no mode, so they stay inspectable but not editable. */
export function editableGeometry(geometry: GeoJsonGeometry): EditableGeometry | null {
  switch (geometry.type) {
    case 'Point':
    case 'LineString':
    case 'Polygon':
      return geometry;
    default:
      return null;
  }
}

/** The mode that can edit a stored geometry in place. */
export function editModeFor(type: GeoJsonGeometry['type']): TerraModeName | null {
  switch (type) {
    case 'Point':
      return 'point';
    case 'LineString':
      return 'linestring';
    case 'Polygon':
      return 'polygon';
    default:
      return null;
  }
}

/** A terra-draw store feature → the geometry the API accepts. */
export function geometryOf(feature: GeoJSONStoreFeatures): GeoJsonGeometry | null {
  const geometry = feature.geometry;
  if (geometry.type === 'Point' || geometry.type === 'LineString' || geometry.type === 'Polygon') {
    return geometry as GeoJsonGeometry;
  }
  return null;
}

/** Design tokens are plain hex (docs/06 §2), but guard anyway — terra-draw only
 *  accepts hex and would throw on anything else. */
export function hexColor(value: string, fallback: HexColor = '#15803d'): HexColor {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? (value as HexColor) : fallback;
}

/** Feature ids come from the database (uuidv7), not from terra-draw's default
 *  uuid4 generator, so the store must accept any non-empty string id. */
const idStrategy = {
  isValidId: (id: string | number): boolean => typeof id === 'string' && id.length > 0,
  getId: (): string => crypto.randomUUID(),
};

/** A terra-draw instance bound to the map, styled with the layer's own color.
 *  Editing flags allow dragging the feature, its vertices and its midpoints. */
export function createDrawing(map: MlMap, color: string, surface: string): TerraDraw {
  const main = hexColor(color);
  const outline = hexColor(surface, '#ffffff');
  const editable = {
    feature: {
      draggable: true,
      coordinates: { midpoints: true, draggable: true, deletable: true },
    },
  };
  return new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    idStrategy,
    modes: [
      new TerraDrawPointMode({
        styles: { pointColor: main, pointOutlineColor: outline, pointWidth: 6 },
      }),
      new TerraDrawLineStringMode({
        styles: { lineStringColor: main, lineStringWidth: 3 },
      }),
      new TerraDrawPolygonMode({
        styles: {
          fillColor: main,
          outlineColor: main,
          fillOpacity: 0.25,
          outlineWidth: 2,
        },
      }),
      new TerraDrawSelectMode({
        flags: { point: editable, linestring: editable, polygon: editable },
        styles: {
          selectedPointColor: main,
          selectedLineStringColor: main,
          selectedPolygonColor: main,
          selectedPolygonFillOpacity: 0.25,
          selectionPointColor: main,
          midPointColor: main,
        },
      }),
    ],
  });
}
