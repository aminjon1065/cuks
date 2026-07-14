import gdal from 'gdal-async';
import { slugify, type GisImportField } from '@cuks/shared';

/**
 * Reading a geodata file with GDAL/OGR (docs/modules/10 §6). The same engine
 * `ogr2ogr` is, driven through its API rather than its CLI: that is what lets the
 * import report a *per-row* error log (§6) instead of a wall of stderr, and it
 * keeps the database credentials out of a child process's argv.
 */

/** A shapefile is a set of sidecar files, so it arrives zipped — GDAL reads it in
 *  place through its `/vsizip/` virtual filesystem, no unpacking step. */
export function gdalPath(localPath: string): string {
  return localPath.toLowerCase().endsWith('.zip') ? `/vsizip/${localPath}` : localPath;
}

/**
 * WGS84 in *traditional GIS order* (longitude, latitude).
 *
 * `SpatialReference.fromEPSG(4326)` would be the obvious target, but GDAL 3
 * honours the authority's axis order for EPSG:4326 — which is latitude first. A
 * reprojection into it silently swaps every coordinate (verified: 3857 → EPSG:4326
 * returns 38.5, 68.8 for a point in Tajikistan). The proj4 form carries no
 * authority axis order, so it keeps lon/lat; the SRID is stamped on the geometry in
 * SQL anyway (`ST_GeomFromWKB(…, 4326)`).
 */
const TARGET_4326 = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');

/**
 * PostGIS column type for an OGR wkb type (which may carry 2.5D/measured bits).
 * Single-part line and polygon layers are promoted to their Multi- form — what
 * `ogr2ogr -nlt PROMOTE_TO_MULTI` does — because a source almost always ends up
 * mixing both, and a column typed `Polygon` would then reject half its own
 * features.
 */
export function flattenGeometryType(wkbType: number): string {
  const base = wkbType & 0xff; // strip the 25D/measured bits
  switch (base) {
    case gdal.wkbPoint:
      return 'Point';
    case gdal.wkbMultiPoint:
      return 'MultiPoint';
    case gdal.wkbLineString:
    case gdal.wkbMultiLineString:
      return 'MultiLineString';
    case gdal.wkbPolygon:
    case gdal.wkbMultiPolygon:
      return 'MultiPolygon';
    default:
      return 'Geometry'; // unknown / mixed / collection — let PostGIS hold anything
  }
}

/** Postgres column type for an OGR field. Dates land as text: sources are wildly
 *  inconsistent about them, and a failed cast would lose the whole row. */
export function postgresFieldType(ogrType: string): string {
  switch (ogrType) {
    case 'integer':
    case 'integer64':
      return 'bigint';
    case 'real':
      return 'double precision';
    case 'binary':
      return 'bytea';
    default:
      return 'text';
  }
}

const RESERVED = new Set(['id', 'geom']);

/**
 * Source field names → safe, unique, lower-case column identifiers. The sources we
 * get name their columns in Russian ("Название", "Ёмкость"), so the name is
 * transliterated — the same way a layer's slug is — rather than stripped down to
 * `field`, `field_2`, which would make the imported table unreadable. A shapefile's
 * DBF also caps names at ten bytes, so collisions are real: they are suffixed.
 */
export function toColumnName(name: string, taken: Set<string>): string {
  const base = slugify(name).replace(/-/g, '_').slice(0, 55) || 'field';
  const safe = RESERVED.has(base) ? `${base}_1` : base;
  if (!taken.has(safe)) {
    taken.add(safe);
    return safe;
  }
  for (let i = 2; ; i++) {
    const candidate = `${safe}_${i}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

export interface SourceField extends GisImportField {
  /** Name in the source file (used to read the value off the feature). */
  sourceName: string;
}

export interface OpenedSource {
  dataset: gdal.Dataset;
  layer: gdal.Layer;
  driver: string;
  /** Layer name inside the dataset. */
  layerName: string;
  geometryType: string;
  fields: SourceField[];
  /** Transform into 4326, or null when the source is already there (or unknown). */
  transform: gdal.CoordinateTransformation | null;
}

/** Open the dataset and describe the layer we are going to import. */
export function openSource(path: string): OpenedSource {
  const dataset = gdal.open(gdalPath(path));
  if (dataset.layers.count() === 0) {
    throw new Error('The file contains no vector layers');
  }
  // The first layer with features; a GPKG or KML can carry several, and an empty
  // first one would otherwise import as "0 objects imported successfully".
  let layer = dataset.layers.get(0);
  for (let i = 0; i < dataset.layers.count(); i++) {
    const candidate = dataset.layers.get(i);
    if (candidate.features.count(true) > 0) {
      layer = candidate;
      break;
    }
  }

  const taken = new Set<string>();
  const fields: SourceField[] = [];
  layer.fields.forEach((field) => {
    const column = toColumnName(field.name, taken);
    fields.push({
      sourceName: field.name,
      name: column,
      type: postgresFieldType(field.type),
    });
  });

  const source = layer.srs;
  const transform = source ? new gdal.CoordinateTransformation(source, TARGET_4326) : null;

  return {
    dataset,
    layer,
    driver: dataset.driver.description,
    layerName: layer.name,
    geometryType: flattenGeometryType(layer.geomType),
    fields,
    transform,
  };
}
