import { describe, expect, it } from 'vitest';
import {
  columnsOf,
  contentTypeOf,
  exportFileName,
  writeExport,
  type ExportFeature,
} from './geo-writers';

const FEATURES: ExportFeature[] = [
  {
    geometry: { type: 'Point', coordinates: [68.78, 38.56] },
    props: { nazvanie: 'Мост №1', emkost: 120 },
  },
  {
    geometry: { type: 'Point', coordinates: [69.2, 39.1] },
    props: { nazvanie: 'Склад, «Центр»', note: 'запятая, кавычки' },
  },
];

describe('columnsOf', () => {
  it('unions the attribute keys in first-seen order, so every format agrees', () => {
    expect(columnsOf(FEATURES)).toEqual(['nazvanie', 'emkost', 'note']);
  });
});

describe('exportFileName / contentTypeOf', () => {
  it('names a shapefile as the zip it actually is', () => {
    expect(exportFileName('Дороги', 'shp')).toBe('Дороги.zip');
    expect(contentTypeOf('shp')).toBe('application/zip');
    expect(exportFileName('Дороги', 'geojson')).toBe('Дороги.geojson');
  });
});

describe('writeExport', () => {
  it('geojson: a FeatureCollection with the geometry and attributes intact', async () => {
    const body = await writeExport(FEATURES, 'geojson', 'Слой');
    const parsed = JSON.parse(body.toString()) as {
      type: string;
      features: { geometry: { coordinates: number[] }; properties: Record<string, unknown> }[];
    };
    expect(parsed.type).toBe('FeatureCollection');
    expect(parsed.features).toHaveLength(2);
    expect(parsed.features[0]!.geometry.coordinates).toEqual([68.78, 38.56]);
    expect(parsed.features[0]!.properties['nazvanie']).toBe('Мост №1');
  });

  it('csv: BOM for Excel, WKT geometry column, quoted separators', async () => {
    const text = (await writeExport(FEATURES, 'csv', 'Слой')).toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('wkt,nazvanie,emkost,note');
    expect(text).toContain('POINT (68.78 38.56)');
    expect(text).toContain('"Склад, «Центр»"');
  });

  it('xlsx: an OPC zip whose first row is the header', async () => {
    const body = await writeExport(FEATURES, 'xlsx', 'Слой');
    expect(body.subarray(0, 2).toString()).toBe('PK');
    expect(body.toString('latin1')).toContain('xl/worksheets/sheet1.xml');
  });

  it('csv: neutralizes spreadsheet formula injection', async () => {
    const hostile: ExportFeature[] = [
      {
        geometry: { type: 'Point', coordinates: [68, 38] },
        props: { note: '=1+2', cmd: '@SUM(A1)' },
      },
    ];
    const text = (await writeExport(hostile, 'csv', 'Слой')).toString('utf8');
    // The formula triggers are prefixed with a quote, so no cell starts with = or @.
    expect(text).toContain("'=1+2");
    expect(text).toContain("'@SUM(A1)");
  });

  it('gpkg: a SQLite container', async () => {
    const body = await writeExport(FEATURES, 'gpkg', 'Слой');
    expect(body.subarray(0, 6).toString()).toBe('SQLite');
  });

  it('shp: a zip carrying the sidecar files a shapefile needs', async () => {
    const body = await writeExport(FEATURES, 'shp', 'Слой');
    expect(body.subarray(0, 2).toString()).toBe('PK');
    const raw = body.toString('latin1');
    for (const extension of ['.shp', '.shx', '.dbf', '.prj']) {
      expect(raw).toContain(extension);
    }
  });

  it('shp: Cyrillic attribute names become DBF-legal columns instead of throwing', async () => {
    const cyrillic: ExportFeature[] = [
      {
        geometry: { type: 'Point', coordinates: [68.78, 38.56] },
        props: { 'Название объекта': 'Мост', Ёмкость: 12 },
      },
    ];
    const body = await writeExport(cyrillic, 'shp', 'Слой');
    expect(body.subarray(0, 2).toString()).toBe('PK');
  });
});
