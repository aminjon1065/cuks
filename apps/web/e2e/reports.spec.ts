import { expect, test } from '@playwright/test';

/**
 * «Конструктор отчётов» (docs/modules/10 §8, task 2.12). Building a report exercises
 * `POST /analytics/query`. Runs in the `authed` project (the seeded superadmin holds
 * analytics.build via wildcard).
 */
test('report constructor: build a report and switch to the АППГ preset', async ({ page }) => {
  await page.goto('/app/analytics/reports');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Конструктор отчётов' }),
  ).toBeVisible();

  // Run the default report (grouped by type).
  const run = page.waitForResponse(
    (r) =>
      r.url().includes('/analytics/query') &&
      !r.url().includes('export') &&
      r.request().method() === 'POST' &&
      r.status() === 201,
  );
  await page.getByRole('button', { name: 'Построить' }).click();
  await run;
  await expect(page.getByRole('columnheader', { name: 'Вид ЧС' })).toBeVisible();

  // The АППГ preset re-runs grouped by month with a year-over-year comparison.
  await page.getByRole('button', { name: 'Сравнение с АППГ' }).click();
  await expect(page.getByRole('columnheader', { name: /АППГ/ }).first()).toBeVisible();
});
