import { expect, test } from '@playwright/test';

// "Сотрудник" (employee) is a seeded operational role. The e2e admin is a superadmin,
// so it may grant it — a non-superadmin can only grant a subset of its own permissions
// (privilege-bounded delegation), which is why the fixture uses the superadmin role.
const ROLE_NAME = 'Сотрудник';

// Runs in the `authed` project (admin session from global-setup).
test('assigns a role to a user', async ({ page }) => {
  await page.goto('/app/admin/users');

  // Arrange: create a throwaway target user via the UI and capture its username.
  // Timestamp in the first name-word → a globally-unique generated username.
  await page.getByTestId('users-create').click();
  await page.locator('#fullName').fill(`Роль${Date.now()} Тест`);
  await page.locator('[role="dialog"] button[type="submit"]').click();
  const username = ((await page.getByTestId('temp-username').textContent()) ?? '').trim();
  expect(username).not.toBe('');

  // Close the reveal dialog and wait for it to fully detach, so the only textbox left
  // is the list's search field (avoids a strict-mode match during the exit animation).
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });

  // Find the new user (server-side search) and open the detail panel.
  await page.getByTestId('users-search').fill(username);
  const row = page.getByRole('row').filter({ hasText: username });
  await expect(row).toBeVisible();
  await row.click();

  // Act: assign the role.
  await page.getByTestId('assign-role-select').selectOption({ label: ROLE_NAME });
  await page.getByTestId('assign-role-confirm').click();

  // Assert: the role now shows in the user's assignment list.
  await expect(page.getByRole('listitem').filter({ hasText: ROLE_NAME })).toBeVisible();
});
