import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gdal from 'gdal-async';
import { buildXlsx, buildZip, type XlsxRow } from '@cuks/shared/office/xlsx';
import { slugify, type GisExportFormat } from '@cuks/shared';

/**
 * Writers for the export formats (docs/modules/10 §6). GeoJSON/CSV/XLSX are written
 * directly — the formats are text and a dependency would buy nothing. GPKG and
 * shapefile go through GDAL, which is also what makes the shapefile a *set* of
 * files: it is zipped so the download is one artifact.
 */

/** One exported object: its geometry as GeoJSON, plus flat attributes. */
export interface ExportFeature {
  geometry: unknown | null;
  props: Record<string, unknown>;
}

export interface ExportResult {
  body: Buffer;
  fileName: string;
  contentType: string;
}

const CONTENT_TYPES: Record<GisExportFormat, string> = {
  geojson: 'application/geo+json',
  gpkg: 'application/geopackage+sqlite3',
  shp: 'application/zip',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const EXTENSIONS: Record<GisExportFormat, string> = {
  geojson: 'geojson',
  gpkg: 'gpkg',
  shp: 'zip',
  csv: 'csv',
  xlsx: 'xlsx',
};

export function exportFileName(baseName: string, format: GisExportFormat): string {
  return `${baseName}.${EXTENSIONS[format]}`;
}

export function contentTypeOf(format: GisExportFormat): string {
  return CONTENT_TYPES[format];
}

/** Column order: stable across formats, so a CSV and an XLSX of the same export
 *  read the same way. */
export function columnsOf(features: readonly ExportFeature[]): string[] {
  const columns: string[] = [];
  for (const feature of features) {
    for (const key of Object.keys(feature.props)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

export async function writeExport(
  features: readonly ExportFeature[],
  format: GisExportFormat,
  layerName: string,
): Promise<Buffer> {
  switch (format) {
    case 'geojson':
      return writeGeoJson(features);
    case 'csv':
      return writeCsv(features);
    case 'xlsx':
      return Buffer.from(writeXlsx(features, layerName));
    case 'gpkg':
      return writeWithGdal(features, layerName, 'GPKG');
    case 'shp':
      return writeWithGdal(features, layerName, 'ESRI Shapefile');
  }
}

function writeGeoJson(features: readonly ExportFeature[]): Buffer {
  const body = {
    type: 'FeatureCollection',
    features: features.map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: feature.props,
    })),
  };
  return Buffer.from(JSON.stringify(body), 'utf8');
}

/** The geometry travels as WKT — a CSV has nowhere else to put it, and QGIS reads
 *  that column back. Excel opens UTF-8 CSV correctly only with a BOM. */
function writeCsv(features: readonly ExportFeature[]): Buffer {
  const columns = columnsOf(features);
  const header = ['wkt', ...columns].map(csvCell).join(',');
  const lines = features.map((feature) =>
    [geometryToWkt(feature.geometry), ...columns.map((c) => stringify(feature.props[c]))]
      .map(csvCell)
      .join(','),
  );
  // U+FEFF as an escape, not a literal: a bare BOM in the source is invisible.
  return Buffer.from(`\ufeff${[header, ...lines].join('\r\n')}\r\n`, 'utf8');
}

function writeXlsx(features: readonly ExportFeature[], sheetName: string): Uint8Array {
  const columns = columnsOf(features);
  const rows: XlsxRow[] = [
    columns,
    ...features.map((feature) =>
      columns.map((column) => {
        const value = feature.props[column];
        return typeof value === 'number' ? value : stringify(value);
      }),
    ),
  ];
  return buildXlsx(rows, sheetName.slice(0, 31) || 'Export');
}

/**
 * GPKG / shapefile through GDAL. The dataset is written to a temp directory and
 * read back: shapefile drivers cannot write to a buffer, and a GPKG is a SQLite
 * file. The shapefile's sidecars are zipped into one download.
 */
async function writeWithGdal(
  features: readonly ExportFeature[],
  layerName: string,
  driverName: 'GPKG' | 'ESRI Shapefile',
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'cuks-geo-export-'));
  try {
    const isShapefile = driverName === 'ESRI Shapefile';
    const safeName = slugify(layerName).replace(/-/g, '_').slice(0, 40) || 'layer';
    const target = isShapefile ? join(dir, 'shp') : join(dir, `${safeName}.gpkg`);

    const driver = gdal.drivers.get(driverName);
    const dataset = driver.create(target);
    // WGS84 in traditional (lon, lat) order — see geo-source.ts for why EPSG:4326
    // itself must not be used here.
    const srs = gdal.SpatialReference.fromProj4('+proj=longlat +datum=WGS84 +no_defs');
    // A shapefile's attributes live in a DBF, whose default encoding is Latin-1:
    // without this a Cyrillic *value* is written as mojibake (and a Cyrillic column
    // name is rejected outright — see `dbfNames` below).
    const layer = dataset.layers.create(
      safeName,
      srs,
      gdal.wkbUnknown,
      isShapefile ? ['ENCODING=UTF-8'] : [],
    );

    // GPKG takes the attribute names as they are; a shapefile cannot — a DBF column
    // is ASCII and ten bytes. Names are transliterated and de-duplicated, and the
    // map is kept so each value still lands in its own column.
    const columns = columnsOf(features);
    const names = isShapefile ? dbfNames(columns) : new Map(columns.map((c) => [c, c]));
    for (const column of columns) {
      layer.fields.add(new gdal.FieldDefn(names.get(column)!, gdal.OFTString));
    }

    for (const feature of features) {
      const item = new gdal.Feature(layer);
      if (feature.geometry) {
        item.setGeometry(gdal.Geometry.fromGeoJson(feature.geometry as object));
      }
      for (const column of columns) {
        item.fields.set(names.get(column)!, stringify(feature.props[column]));
      }
      layer.features.add(item);
    }
    layer.flush();
    dataset.close();

    if (!isShapefile) return readFile(target);

    const written = await readdir(target);
    const entries: Record<string, Uint8Array> = {};
    for (const name of written) entries[name] = await readFile(join(target, name));
    return Buffer.from(buildZip(entries));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Attribute names a DBF accepts: ASCII, ten bytes, unique. */
function dbfNames(columns: readonly string[]): Map<string, string> {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const column of columns) {
    const base = (slugify(column).replace(/-/g, '_').slice(0, 10) || 'f').replace(/_+$/, '');
    let candidate = base || 'f';
    for (let i = 2; taken.has(candidate); i++) candidate = `${base.slice(0, 8)}_${i}`;
    taken.add(candidate);
    names.set(column, candidate);
  }
  return names;
}

function geometryToWkt(geometry: unknown): string {
  if (!geometry) return '';
  try {
    return gdal.Geometry.fromGeoJson(geometry as object).toWKT();
  } catch {
    return '';
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * A CSV field. Beyond RFC-4180 quoting, a value that opens with a formula trigger
 * (= + - @, or a tab/CR that some parsers strip first) is prefixed with a single
 * quote: Excel/LibreOffice would otherwise evaluate `=…` from an exported cell as a
 * formula (CSV injection). The prefix is the standard, display-safe mitigation.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
