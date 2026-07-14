import { expect, test, type Page } from '@playwright/test';

/**
 * Drawn layers, geometry editing and the object inspector (docs/modules/10 §4,
 * task 2.7). Runs in the `authed` project (the seeded e2e superadmin, so every
 * layer is editable). Requires the Martin tile server — the drawn features come
 * back to the map as vector tiles, exactly as in production.
 */

/** A point on the map canvas, clear of the panels that overlay its edges. */
function mapPoint(
  box: { x: number; y: number; width: number; height: number },
  fx: number,
  fy: number,
) {
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function waitForStyle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cuksMap?.isStyleLoaded() === true);
}

test('drawn layers: create, draw a polygon, inspect it, edit its geometry, delete', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const title = `E2E слой ${Date.now()}`;

  await page.goto('/app/map');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await waitForStyle(page);

  // --- Create a drawn layer; the creator manages it, so it becomes the target ---
  await page.getByTestId('create-layer').click();
  await page.getByLabel('Название слоя').fill(title);
  await page.getByLabel('Тип геометрии').selectOption('Polygon');
  const created = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/gis/layers') &&
      response.request().method() === 'POST' &&
      response.status() === 201,
  );
  await page.getByRole('button', { name: 'Создать слой' }).click();
  const layerId = ((await (await created).json()) as { id: string }).id;
  await expect(page.getByText('Слой создан')).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();

  // The drawing toolbar appears for the target layer and offers only polygons.
  const toolbar = page.getByTestId('draw-toolbar');
  await expect(toolbar).toBeVisible();
  await expect(page.getByTestId('draw-tool-polygon')).toBeVisible();
  await expect(page.getByTestId('draw-tool-point')).toHaveCount(0);

  // --- Draw a polygon: three vertices, Enter to finish (terra-draw) ---
  const box = (await page.getByTestId('map-canvas').boundingBox())!;
  expect(box).not.toBeNull();
  const vertices = [mapPoint(box, 0.45, 0.35), mapPoint(box, 0.68, 0.35), mapPoint(box, 0.68, 0.6)];
  const featureCreated = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/gis/features') &&
      response.request().method() === 'POST' &&
      response.status() === 201,
  );
  await page.getByTestId('draw-tool-polygon').click();
  for (const vertex of vertices) await page.mouse.click(vertex.x, vertex.y);
  await page.keyboard.press('Enter');
  const featureId = ((await (await featureCreated).json()) as { id: string }).id;
  await expect(page.getByText('Объект добавлен')).toBeVisible();

  // It is stored on the layer and served as a tile.
  const stored = await page.request.get(`/api/v1/gis/features?layerId=${layerId}`);
  expect(stored.ok()).toBeTruthy();
  expect(((await stored.json()) as unknown[]).length).toBe(1);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__cuksMap?.querySourceFeatures('layer_features_mvt', {
              sourceLayer: 'layer_features',
            }).length ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // --- Inspect it: leaving the tool, a click opens the peek card ---
  await page.getByTestId('draw-tool-polygon').click();
  const centroid = {
    x: (vertices[0]!.x + vertices[1]!.x + vertices[2]!.x) / 3,
    y: (vertices[0]!.y + vertices[1]!.y + vertices[2]!.y) / 3,
  };
  const inspector = page.getByTestId('map-inspector');
  await expect
    .poll(
      async () => {
        await page.mouse.click(centroid.x, centroid.y);
        return inspector.getByText('Нарисованный объект').isVisible();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  // The click also hits the administrative unit under the polygon; the drawn
  // object is what the card opens on, the rest stay one «Назад» away.
  await expect(inspector.getByText(title)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Назад к списку' })).toBeVisible();

  // --- Edit the geometry: drag a vertex, then commit from the inspector ---
  await page.getByTestId('inspector-edit').click();
  const saveButton = page.getByTestId('inspector-save');
  await expect(saveButton).toBeDisabled(); // nothing moved yet

  const handle = vertices[0]!;
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 40, handle.y - 30, { steps: 8 });
  await page.mouse.up();

  const patched = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/gis/features/${featureId}`) &&
      response.request().method() === 'PATCH' &&
      response.status() === 200,
  );
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await patched;
  await expect(page.getByText('Геометрия сохранена')).toBeVisible();

  // --- Delete the feature (confirmed), then the layer ---
  const removed = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/gis/features/${featureId}`) &&
      response.request().method() === 'DELETE' &&
      response.status() === 200,
  );
  await page.getByTestId('inspector-delete').click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await removed;
  await expect(page.getByText('Объект удалён')).toBeVisible();
  await expect(inspector).toHaveCount(0);

  const afterDelete = await page.request.get(`/api/v1/gis/features?layerId=${layerId}`);
  expect(((await afterDelete.json()) as unknown[]).length).toBe(0);

  const layerRemoved = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/gis/layers/${layerId}`) &&
      response.request().method() === 'DELETE' &&
      response.status() === 200,
  );
  await page.getByRole('button', { name: `Удалить слой «${title}»` }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await layerRemoved;
  await expect(page.getByText('Слой удалён')).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});
