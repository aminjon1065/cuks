import { expect, test } from '@playwright/test';

/**
 * Geodata import and export (docs/modules/10 §6, task 2.8). Runs in the `authed`
 * project (the seeded e2e superadmin, who holds gis.import/gis.export). Requires
 * the worker — the reading and writing happen there — plus Martin, which serves the
 * imported layer back to the map.
 */

/** A GeoJSON with one good polygon, one self-intersecting polygon (must be repaired)
 *  and one feature without geometry (must be skipped, and named in the log). */
const SOURCE = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { Название: 'Мост №1', Ёмкость: 120 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [68.7, 38.5],
            [68.9, 38.5],
            [68.9, 38.7],
            [68.7, 38.7],
            [68.7, 38.5],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { Название: 'Бабочка', Ёмкость: 5 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [69.0, 39.0],
            [69.2, 39.2],
            [69.2, 39.0],
            [69.0, 39.2],
            [69.0, 39.0],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { Название: 'Без геометрии', Ёмкость: 0 },
      geometry: null,
    },
  ],
});

test('geodata: import a GeoJSON layer, see it on the map, export it back', async ({ page }) => {
  test.setTimeout(120_000);
  const title = `E2E импорт ${Date.now()}`;

  await page.goto('/app/map');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForFunction(() => window.__cuksMap?.isStyleLoaded() === true);

  // --- Import ---
  await page.getByTestId('import-layer').click();
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await page.getByLabel('Название слоя').fill(title);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-import.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(SOURCE),
  });

  // The worker reads the file, repairs what it can and reports the rest per row.
  await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('import-preview')).toContainText('Импортировано объектов: 2');
  await expect(page.getByTestId('import-preview')).toContainText('пропущено: 1');
  await expect(page.getByTestId('import-preview')).toContainText('MultiPolygon');
  // Cyrillic attribute names are transliterated, not dropped.
  await expect(page.getByTestId('import-preview')).toContainText('nazvanie');

  await page.getByText('Журнал импорта').click();
  await expect(page.getByTestId('import-preview')).toContainText('строка 3: нет геометрии');
  await page.getByRole('button', { name: 'Готово' }).click();

  // The layer is in «Мои слои» and its features come back as tiles.
  await expect(page.getByText(title)).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__cuksMap?.getStyle().layers.filter((layer) => layer.id.startsWith('imported:'))
              .length ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__cuksMap?.querySourceFeatures(
              Object.keys(window.__cuksMap.getStyle().sources).find((id) =>
                id.startsWith('imported:'),
              )!,
              { sourceLayer: 'imported' },
            ).length ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  // --- Export it back ---
  const layerId = await page.evaluate(() =>
    Object.keys(window.__cuksMap!.getStyle().sources)
      .find((id) => id.startsWith('imported:'))!
      .slice('imported:'.length),
  );
  await page.getByTestId(`export-layer-${layerId}`).click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByLabel('Формат').selectOption('gpkg');
  await page.getByTestId('export-submit').click();

  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('export-ready')).toContainText('2 объектов');

  const download = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('.gpkg');
});

test('geodata: export the incident selection from the registry', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/app/incidents');
  await expect(page.getByTestId('incidents-export-geo')).toBeVisible();

  await page.getByTestId('incidents-export-geo').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByLabel('Формат').selectOption('geojson');
  await page.getByTestId('export-submit').click();

  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  expect((await download).suggestedFilename()).toContain('.geojson');
});
