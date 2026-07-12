import { expect, test } from '@playwright/test';

test('app boots and shows the placeholder', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ЦУКС' })).toBeVisible();
});
