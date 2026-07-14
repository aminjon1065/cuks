import gdal from 'gdal-async';
import { describe, expect, it } from 'vitest';
import { flattenGeometryType, gdalPath, postgresFieldType, toColumnName } from './geo-source';

describe('gdalPath', () => {
  it('reads a zipped shapefile in place through the virtual filesystem', () => {
    expect(gdalPath('/tmp/roads.zip')).toBe('/vsizip//tmp/roads.zip');
    expect(gdalPath('/tmp/ROADS.ZIP')).toBe('/vsizip//tmp/ROADS.ZIP');
    expect(gdalPath('/tmp/roads.geojson')).toBe('/tmp/roads.geojson');
  });
});

describe('flattenGeometryType', () => {
  it('promotes single-part lines and polygons to their Multi- form', () => {
    expect(flattenGeometryType(gdal.wkbPolygon)).toBe('MultiPolygon');
    expect(flattenGeometryType(gdal.wkbMultiPolygon)).toBe('MultiPolygon');
    expect(flattenGeometryType(gdal.wkbLineString)).toBe('MultiLineString');
    expect(flattenGeometryType(gdal.wkbMultiLineString)).toBe('MultiLineString');
  });

  it('keeps points as points', () => {
    expect(flattenGeometryType(gdal.wkbPoint)).toBe('Point');
    expect(flattenGeometryType(gdal.wkbMultiPoint)).toBe('MultiPoint');
  });

  it('strips the 2.5D bit — an elevated polygon is still a polygon layer', () => {
    expect(flattenGeometryType(gdal.wkbPolygon | 0x80000000)).toBe('MultiPolygon');
  });

  it('falls back to a geometry column for unknown/mixed sources', () => {
    expect(flattenGeometryType(gdal.wkbUnknown)).toBe('Geometry');
    expect(flattenGeometryType(gdal.wkbGeometryCollection)).toBe('Geometry');
  });
});

describe('postgresFieldType', () => {
  it('maps OGR field types onto column types', () => {
    expect(postgresFieldType('integer')).toBe('bigint');
    expect(postgresFieldType('integer64')).toBe('bigint');
    expect(postgresFieldType('real')).toBe('double precision');
    expect(postgresFieldType('string')).toBe('text');
    // Dates stay text: sources disagree wildly, and a failed cast would cost the row.
    expect(postgresFieldType('date')).toBe('text');
  });
});

describe('toColumnName', () => {
  it('transliterates Russian column names instead of dropping them', () => {
    const taken = new Set<string>();
    expect(toColumnName('Название', taken)).toBe('nazvanie');
    expect(toColumnName('Ёмкость', taken)).toBe('emkost');
  });

  it('de-duplicates names that collide after transliteration', () => {
    const taken = new Set<string>();
    expect(toColumnName('Название', taken)).toBe('nazvanie');
    expect(toColumnName('название', taken)).toBe('nazvanie_2');
  });

  it('never returns a reserved or empty identifier', () => {
    const taken = new Set<string>();
    expect(toColumnName('geom', taken)).toBe('geom_1');
    expect(toColumnName('id', taken)).toBe('id_1');
    expect(toColumnName('!!!', taken)).toBe('layer'); // slugify's own fallback
  });
});
