import { expect, request, test } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_DUTY, STORAGE_STATE } from './support/fixtures';

/**
 * Task 7.3 — admin health dashboard (docs/modules/16 §7) + the monitoring alert webhook. The UI smoke
 * runs in the `authed` project (seeded superadmin holds admin.system.monitor via wildcard); the API
 * tests assert the ACL (duty_officer lacks the permission → 403) and that the alert webhook is disabled
 * when unconfigured (dev/e2e sets no MONITORING_* → 404).
 */
const API = 'http://localhost:3000';

test('health dashboard renders services, queues and storage', async ({ page }) => {
  await page.goto('/app/admin/health');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Здоровье платформы' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сервисы' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Очереди задач' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Хранилище' })).toBeVisible();
  // A known probe label — its presence means /admin/health answered end-to-end.
  await expect(page.getByText('PostgreSQL')).toBeVisible();
});

test('admin health API: shape, ACL and unknown-queue 404', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const duty = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
  try {
    const res = await admin.get('/api/v1/admin/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      services: unknown[];
      queues: unknown[];
      storage: unknown;
      errors24h: number;
      backup: unknown;
    };
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services.length).toBeGreaterThan(0);
    expect(Array.isArray(body.queues)).toBe(true);
    expect(body.storage).toBeTruthy();
    expect(typeof body.errors24h).toBe('number');
    expect(body).toHaveProperty('backup');

    // duty_officer has meet/chat/etc. but not admin.system.monitor → 403.
    expect((await duty.get('/api/v1/admin/health')).status()).toBe(403);

    // Bodyless POST → csrf-only headers (no json content-type). Unknown queue → 404.
    const csrf = await csrfHeaders(admin);
    const retry = await admin.post('/api/v1/admin/health/queues/does-not-exist/retry', {
      headers: csrf,
    });
    expect(retry.status()).toBe(404);
  } finally {
    await admin.dispose();
    await duty.dispose();
  }
});

test('monitoring alert webhook is disabled (404) without configuration', async () => {
  const ctx = await request.newContext({ baseURL: API });
  try {
    // @Public endpoint; disabled because MONITORING_WEBHOOK_SECRET / _CHANNEL_ID are unset in dev/e2e.
    const res = await ctx.post('/api/monitoring/alert', {
      headers: { 'x-monitoring-secret': 'whatever' },
      data: { msg: 'test alert' },
    });
    expect(res.status()).toBe(404);
  } finally {
    await ctx.dispose();
  }
});
