import { expect, test } from '@playwright/test';

// Runs in the `authed` project (admin session from global-setup). Smoke-tests the
// map explorer (docs/modules/10 §4): the map mounts, the layer panel and basemap
// switcher render, a layer toggles, and zoom-to-layer is reachable.
//
// Requires the Martin tile server (docker `martin`, host port 3001) to be up —
// the page probes `/tiles/catalog` before rendering. Same infra prerequisite as
// the files specs (MinIO).
test('map screen: layers panel, basemap switcher, and layer toggle', async ({ page }) => {
  await page.goto('/app/map');

  // Map container mounts and the layer panel is present (catalog loaded).
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByText('Слои', { exact: true })).toBeVisible();

  // Default-visible system layer is checked; toggling flips it.
  const adminUnits = page.getByRole('checkbox', { name: 'Административные границы' });
  await expect(adminUnits).toBeChecked();
  await adminUnits.click();
  await expect(adminUnits).not.toBeChecked();

  // Zoom-to-layer control is reachable.
  await expect(
    page.getByRole('button', { name: /Приблизить к слою «Административные границы»/ }),
  ).toBeVisible();

  // Basemap switcher opens and offers the dark basemap.
  await page.getByRole('button', { name: 'Подложка' }).click();
  await expect(page.getByRole('button', { name: 'Тёмная' })).toBeVisible();
});

test('map screen: layer panel collapses and expands', async ({ page }) => {
  await page.goto('/app/map');

  await expect(page.getByText('Слои', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Свернуть панель' }).click();
  await expect(page.getByText('Слои', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Показать слои' }).click();
  await expect(page.getByText('Слои', { exact: true })).toBeVisible();
});
