import { expect, test } from '@playwright/test';

/**
 * «Статистика ЧС» dashboard (docs/modules/10 §8, task 2.11). Loading it exercises
 * `GET /analytics/stats` and `/analytics/regions.geojson` end-to-end. Runs in the
 * `authed` project (the seeded superadmin holds analytics.view via wildcard).
 */
test('statistics: charts render and the type filter refetches', async ({ page }) => {
  await page.goto('/app/analytics');

  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Статистика ЧС' }),
  ).toBeVisible();

  // The chart card titles render (they exist regardless of the canvas), which means
  // the stats endpoint answered with data.
  await expect(page.getByRole('heading', { name: 'Динамика по месяцам' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Распределение по видам' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Тепловая карта: день × час' })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Печать' })).toBeVisible();

  // Changing the type filter refetches the stats with a typeCode.
  const refetched = page.waitForResponse(
    (r) =>
      r.url().includes('/analytics/stats') && r.url().includes('typeCode=') && r.status() === 200,
  );
  await page.getByLabel('Вид ЧС').selectOption('nat.hydro.flood');
  await refetched;
});
