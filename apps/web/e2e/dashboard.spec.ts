import { expect, test } from '@playwright/test';

/**
 * «Оперативная сводка» dashboard (docs/modules/10 §8, task 2.10). The home page
 * after login; loading it exercises `GET /analytics/summary` end-to-end. Runs in
 * the `authed` project (the seeded superadmin holds analytics.view via wildcard).
 */
test('dashboard: operational summary shows KPIs, active map and reports feed', async ({ page }) => {
  await page.goto('/app');

  // Header (also present in the topbar, so scope to the page body).
  await expect(page.getByRole('main').getByRole('heading', { name: 'Дашборд' })).toBeVisible();

  // KPI cards — their presence means the summary endpoint answered.
  await expect(page.getByText('ЧС всего')).toBeVisible();
  await expect(page.getByText('Пострадавшие')).toBeVisible();
  await expect(page.getByText('Ущерб, сомони')).toBeVisible();

  // The three summary panels render their titles.
  await expect(page.getByRole('heading', { name: 'Активные ЧС' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Последние донесения' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Требует внимания' })).toBeVisible();

  // The «Требует внимания» aggregator shows its (still empty) source slots.
  await expect(page.getByText('Мои задачи')).toBeVisible();

  // Switching the period keeps the dashboard working (refetches the summary).
  await expect(page.getByRole('tab', { name: '7 дней' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '30 дней' }).click();
  await expect(page.getByRole('tab', { name: '30 дней' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('ЧС всего')).toBeVisible();
});
