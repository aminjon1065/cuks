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

  // KPI cards — their presence means the summary endpoint answered. Exact, because the
  // reports feed underneath also prints «Пострадавшие: N» per incident.
  await expect(page.getByText('ЧС всего', { exact: true })).toBeVisible();
  await expect(page.getByText('Пострадавшие', { exact: true })).toBeVisible();
  await expect(page.getByText('Ущерб, сомони', { exact: true })).toBeVisible();

  // The three summary panels render their titles.
  await expect(page.getByRole('heading', { name: 'Активные ЧС' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Последние донесения' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Требует внимания' })).toBeVisible();

  // «Требует внимания» now carries real counts: either the seeded queues have work, in which
  // case each row links to the list that produced its number, or the widget says so plainly.
  const attention = page.getByRole('main').locator('section', { hasText: 'Требует внимания' });
  const queueLink = attention.getByRole('link').first();
  if (await queueLink.isVisible().catch(() => false)) {
    await expect(queueLink).toHaveAttribute('href', /\/app\/docs/);
  } else {
    await expect(page.getByText('Ничего не ждёт вашего действия')).toBeVisible();
  }

  // Switching the period keeps the dashboard working (refetches the summary).
  await expect(page.getByRole('tab', { name: '7 дней' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '30 дней' }).click();
  await expect(page.getByRole('tab', { name: '30 дней' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('ЧС всего')).toBeVisible();
});
