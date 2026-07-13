import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { E2E_ADMIN, STORAGE_STATE, TOTP_SECRET_FILE, freshTotp } from './support/fixtures';

/**
 * The provisioned e2e admin (see packages/db/src/seed-e2e.ts) requires 2FA but is
 * reset to a not-yet-enrolled state every run. Here we log in and complete TOTP
 * enrollment through the real UI — the enroll page exposes the base32 secret — then
 * persist an authenticated storageState (reused by the admin specs) plus the secret
 * (so the login spec can re-drive a fresh two-step 2FA login).
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:5173';
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  try {
    await page.goto('/login');
    await page.locator('#username').fill(E2E_ADMIN.username);
    await page.locator('#password').fill(E2E_ADMIN.password);
    await page.locator('form button[type="submit"]').click();

    // No forced password change (flag cleared) → straight to TOTP enrollment. If the
    // admin isn't in the reset (not-yet-enrolled) state, password-only login asks for
    // a 2FA code instead of redirecting here — surface that clearly rather than hang.
    await page.waitForURL('**/enroll-totp', { timeout: 30_000 }).catch(() => {
      throw new Error(
        'e2e admin is not in a fresh 2FA-reset state — run `pnpm db:seed:e2e` first (or use `pnpm e2e`).',
      );
    });
    const secret = (await page.getByTestId('totp-secret').textContent())?.trim();
    if (!secret) throw new Error('TOTP secret did not render on the enrollment page');

    await page.locator('#code').fill(await freshTotp(secret));
    await page.locator('form button[type="submit"]').click();

    // On confirm, `me` refetches with totpEnabled=true and AuthGate redirects the
    // enrollment route straight to the app shell (the backup-codes view only flashes).
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });

    mkdirSync(dirname(STORAGE_STATE), { recursive: true });
    await page.context().storageState({ path: STORAGE_STATE });
    writeFileSync(TOTP_SECRET_FILE, secret, 'utf8');
  } finally {
    await browser.close();
  }
}

export default globalSetup;
