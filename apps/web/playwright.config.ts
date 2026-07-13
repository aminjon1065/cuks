import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const STORAGE_STATE = fileURLToPath(new URL('./e2e/.auth/admin.json', import.meta.url));

/**
 * Playwright e2e (docs/plan 0.14 — login, create user, assign role). `global-setup`
 * enrolls the seeded e2e admin's 2FA and saves an authenticated storageState reused
 * by the admin specs; the login spec drives auth from scratch in its own project.
 * The api + web dev servers are started (or reused locally) via `webServer`; the DB
 * must be migrated, seeded and provisioned (`pnpm --filter @cuks/db seed:e2e`) first.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  // Headroom for Vite dev's on-demand route compilation on the first authenticated
  // render (the default 5s can flake a loaded CI runner).
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    // Fresh context — exercises the full login + 2FA flow.
    { name: 'login', testMatch: /login\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
    // Admin flows — reuse the enrolled-admin session from global-setup.
    {
      name: 'authed',
      testIgnore: /login\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @cuks/api dev',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter @cuks/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
