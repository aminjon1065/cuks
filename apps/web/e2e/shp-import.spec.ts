import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { GisImportDto } from '@cuks/shared';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Shapefile import acceptance (docs/modules/10 §11: «Импорт SHP … проходит; слой
 * виден в вебе и в QGIS (PostGIS + WFS) без ручных действий», task 2.13). Drives the
 * real pipeline over the API: reserve → presigned upload → worker reads the zipped
 * shapefile with GDAL → the layer lands in PostGIS (served to the web by Martin) and,
 * once published, is served to QGIS over GeoServer WFS.
 *
 * A committed 2 000-feature fixture keeps CI fast; the 100 000-feature scale target is
 * covered by `pnpm db:seed:perf`-style load runs (see docs/plan/STATUS.md). The fixture
 * is a point shapefile zipped with its sidecars (.shp/.shx/.dbf/.prj).
 */
const API = 'http://localhost:3000';
const WFS = 'http://localhost:8080/geoserver/cuks/ows';
const FIXTURE = fileURLToPath(new URL('./fixtures/points-2k.shp.zip', import.meta.url));
const EXPECTED_FEATURES = 2000;

/** Auth headers from the enrolled-admin storageState (the admin is 2FA-gated, so a
 *  password-only apiLogin can't stand in here). */
function authHeaders(): Record<string, string> {
  const state = JSON.parse(readFileSync(STORAGE_STATE, 'utf8')) as {
    cookies: { name: string; value: string }[];
  };
  const value = (name: string): string => state.cookies.find((c) => c.name === name)?.value ?? '';
  return {
    cookie: `cuks_session=${value('cuks_session')}; cuks_csrf=${value('cuks_csrf')}`,
    'x-csrf-token': value('cuks_csrf'),
  };
}

test('geodata: a shapefile import lands in PostGIS and is served over WFS', async ({ request }) => {
  test.setTimeout(120_000);
  const headers = authHeaders();
  const bytes = readFileSync(FIXTURE);
  const fileName = `e2e-shp-${Date.now()}.shp.zip`;

  // 1. Reserve the record and get a presigned PUT.
  const create = await request.post(`${API}/api/v1/gis/imports`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { fileName, size: bytes.length, title: `E2E SHP ${Date.now()}` },
  });
  expect(create.ok(), `create ${create.status()}`).toBeTruthy();
  const { importId, uploadUrl } = (await create.json()) as { importId: string; uploadUrl: string };

  // 2. Upload straight to storage, then 3. queue the worker.
  const put = await request.put(uploadUrl, {
    headers: { 'content-type': 'application/octet-stream' },
    data: bytes,
  });
  expect(put.ok(), `upload ${put.status()}`).toBeTruthy();
  const start = await request.post(`${API}/api/v1/gis/imports/${importId}/start`, { headers });
  expect(start.ok(), `start ${start.status()}`).toBeTruthy();

  // 4. The worker reads the shapefile and registers the layer.
  let dto: GisImportDto | undefined;
  await expect
    .poll(
      async () => {
        dto = (await (
          await request.get(`${API}/api/v1/gis/imports/${importId}`, { headers })
        ).json()) as GisImportDto;
        return dto.status;
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe('done');

  expect(dto?.preview?.featureCount).toBe(EXPECTED_FEATURES);
  expect(dto?.preview?.skippedCount).toBe(0);
  expect(dto?.preview?.geometryType).toBe('Point');
  const layerId = dto?.layerId;
  expect(layerId, 'import registered a layer').toBeTruthy();

  try {
    // 5. Publish to GeoServer and confirm WFS serves every feature (the QGIS path).
    const publish = await request.post(`${API}/api/v1/gis/layers/${layerId}/publish`, { headers });
    expect(publish.ok(), `publish ${publish.status()}`).toBeTruthy();
    const { geoserverLayer, isPublishedWms } = (await publish.json()) as {
      geoserverLayer: string;
      isPublishedWms: boolean;
    };
    expect(isPublishedWms).toBe(true);

    const hits = await request.get(
      `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${geoserverLayer}&resultType=hits`,
    );
    expect(hits.ok(), `WFS hits ${hits.status()}`).toBeTruthy();
    const matched = (await hits.text()).match(/numberMatched="(\d+)"/)?.[1];
    expect(matched).toBe(String(EXPECTED_FEATURES));
  } finally {
    // Keep reruns clean: dropping the layer unpublishes it and drops its table.
    await request.delete(`${API}/api/v1/gis/layers/${layerId}`, { headers });
  }
});
