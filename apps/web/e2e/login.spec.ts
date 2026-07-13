import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { TOTP_SECRET_FILE, loginWithTotp } from './support/fixtures';

// Runs in the `login` project: a clean context with no stored session, so it
// exercises the full two-step login + 2FA UI for the enrolled admin.
test('logs in with password and a two-factor code', async ({ page }) => {
  const secret = readFileSync(TOTP_SECRET_FILE, 'utf8').trim();
  await loginWithTotp(page, secret);
  await expect(page).toHaveURL(/\/app(\/|$)/);
});
