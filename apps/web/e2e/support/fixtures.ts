import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { authenticator } from 'otplib';

/**
 * Dedicated e2e admin (superadmin). Provisioned in the DB by
 * packages/db/src/seed-e2e.ts — keep the credentials in sync with it.
 */
export const E2E_ADMIN = {
  username: 'e2e_admin',
  password: 'E2eAdmin!Passw0rd',
} as const;

/**
 * Plain non-superadmin (files.use, no 2FA gate). Provisioned alongside the admin by
 * packages/db/src/seed-e2e.ts — used by the phase-1 permission specs (task 1.9).
 */
export const E2E_USER = {
  username: 'e2e_user',
  password: 'E2eUser!Passw0rd',
} as const;

/** A second plain user — the permission spec needs owner + other, both non-admin. */
export const E2E_USER2 = {
  username: 'e2e_user2',
  password: 'E2eUser2!Passw0rd',
} as const;

/** Password-only operational recipient for the incident notification matrix. */
export const E2E_DUTY = {
  username: 'e2e_duty',
  password: 'E2eDuty!Passw0rd',
} as const;

/** Auth artifacts written by global-setup, consumed by the specs (gitignored). */
export const STORAGE_STATE = fileURLToPath(new URL('../.auth/admin.json', import.meta.url));
export const TOTP_SECRET_FILE = fileURLToPath(new URL('../.auth/totp-secret.txt', import.meta.url));

const TOTP_STEP_SECONDS = 30;
let lastUsedStep = -1;

/**
 * A fresh 6-digit TOTP that never reuses a 30s step within this worker. Rolls to the
 * next step when the current one is nearly over (avoids expiry mid-submit) OR was
 * already used — so a Playwright retry can't resubmit a code the login replay-guard
 * (verifyForLogin, one code per step) has already consumed.
 */
export async function freshTotp(secret: string): Promise<string> {
  const step = (): number => Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const remaining = authenticator.timeRemaining();
  if (remaining < 5 || step() <= lastUsedStep) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
  }
  lastUsedStep = step();
  return authenticator.generate(secret);
}

/**
 * Drive the real two-step login UI for the enrolled e2e admin: username + password,
 * then the 2FA code once the server asks for it. Leaves the page on the app shell.
 */
export async function loginWithTotp(page: Page, secret: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#username').fill(E2E_ADMIN.username);
  await page.locator('#password').fill(E2E_ADMIN.password);
  await page.locator('form button[type="submit"]').click();

  // Two-step: the 2FA input only appears after the server returns totp_required.
  const totp = page.locator('#totp');
  await expect(totp).toBeVisible();
  await totp.fill(await freshTotp(secret));
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByTestId('app-shell')).toBeVisible();
}
