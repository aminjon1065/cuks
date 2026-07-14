import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// These scenarios share the GIS broadcast room; serial execution keeps the
// `revision=1` assertion tied to the incident created by this exact test.
test.describe.configure({ mode: 'serial' });

type MapDiagnosticWindow = Window & {
  __cuksMap?: { isStyleLoaded(): boolean };
  __cuksSocket?: { connected: boolean };
  __cuksSocketReady?: boolean;
};

// Registry happy-path (docs/modules/10 §5): an operator creates a fast first
// report, opens the permanent card, adds a chronology entry and deployed force.
test('incident registry: creates a report, chronology entry and resource', async ({ page }) => {
  await page.goto('/app/incidents');
  await expect(page.getByRole('heading', { name: 'Чрезвычайные ситуации' })).toBeVisible();

  await page.getByTestId('incidents-create').click();
  await page.locator('#incident-type').selectOption({ index: 1 });
  await page.locator('#incident-description').fill(`E2E incident ${Date.now()}`);
  await page.getByTestId('incidents-create-submit').click();

  await page.waitForURL(/\/app\/incidents\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('tab', { name: 'Обзор' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Добавить донесение' }).click();
  await page.locator('#report-text').fill('E2E follow-up report');
  await page.locator('[role="dialog"] button[type="submit"]').click();
  await page.getByRole('tab', { name: 'Хронология' }).click();
  await expect(page.getByText('E2E follow-up report')).toBeVisible();

  await page.getByRole('button', { name: 'Добавить донесение' }).click();
  await page.locator('#report-injured').fill('2');
  await page.locator('#report-damage').fill('1234.50');
  await page.locator('[role="dialog"] button[type="submit"]').click();
  await expect(page.getByTestId('incident-report-snapshot').first()).toContainText('2');
  await expect(page.getByTestId('incident-report-snapshot').first()).toContainText('1');

  await page.getByRole('tab', { name: 'Силы и средства' }).click();
  await page.getByRole('button', { name: 'Добавить силы / средства' }).click();
  await page.locator('#resource-name').fill('E2E rescue unit');
  await page.locator('[role="dialog"] button[type="submit"]').click();
  await expect(page.getByText('E2E rescue unit')).toBeVisible();
});

test('new registry incident refreshes an already open operational map', async ({
  page,
  context,
}) => {
  await page.goto('/app/map');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForFunction(
    () => (window as MapDiagnosticWindow).__cuksMap?.isStyleLoaded() === true,
  );
  await page.waitForFunction(() => (window as MapDiagnosticWindow).__cuksSocketReady === true);

  const csrf = (await context.cookies()).find((cookie) => cookie.name === 'cuks_csrf')?.value;
  expect(csrf).toBeTruthy();
  const refreshedTile = page.waitForRequest(
    (request) => {
      const url = new URL(request.url());
      return (
        url.pathname.includes('/tiles/incidents_mvt/') && url.searchParams.get('revision') === '1'
      );
    },
    { timeout: 15_000 },
  );
  const response = await page.request.post('/api/v1/incidents', {
    headers: { 'x-csrf-token': csrf! },
    data: {
      typeCode: 'nat.hydro.flood',
      severity: 2,
      occurredAt: '2026-07-14T10:00:00.000Z',
      location: { longitude: 68.787, latitude: 38.559 },
      description: 'E2E map refresh',
      source: 'phone',
      dead: 0,
      injured: 0,
      evacuated: 0,
      affected: 0,
    },
  });
  expect(response.ok()).toBeTruthy();
  await refreshedTile;
});

test('registry saves and removes a filter, exports XLSX, and supports keyboard detail navigation', async ({
  page,
}) => {
  await page.goto('/app/incidents');
  await expect(page.getByRole('heading', { name: 'Чрезвычайные ситуации' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт XLSX' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('incidents.xlsx');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect((await readFile(downloadPath!)).subarray(0, 2).toString()).toBe('PK');

  const filterName = `E2E saved filter ${Date.now()}`;
  const search = page.getByTestId('incidents-search');
  await search.fill('E2E saved filter query');
  await page.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await page.locator('#incident-filter-name').fill(filterName);
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();

  await search.fill('different query');
  const savedSelect = page.getByLabel('Сохранённые фильтры');
  await savedSelect.selectOption({ label: filterName });
  await expect(search).toHaveValue('E2E saved filter query');
  await page.getByRole('button', { name: 'Удалить сохранённый фильтр' }).click();
  await expect(page.getByRole('dialog')).toContainText(filterName);
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(savedSelect).not.toContainText(filterName);
  await page.getByRole('button', { name: 'Сбросить' }).click();

  const firstRow = page.locator('tbody tr').first();
  await firstRow.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await firstRow.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/app\/incidents\/[0-9a-f-]{36}$/);
});

test('registry refreshes for another operator and rejects invalid report chronology', async ({
  browser,
  context,
  page,
}) => {
  await page.goto('/app/incidents');
  await page.waitForFunction(() => (window as MapDiagnosticWindow).__cuksSocketReady === true);

  const otherContext = await browser.newContext({ storageState: await context.storageState() });
  try {
    const csrf = (await otherContext.cookies()).find(
      (cookie) => cookie.name === 'cuks_csrf',
    )?.value;
    expect(csrf).toBeTruthy();
    const createdResponse = await otherContext.request.post(
      'http://localhost:5173/api/v1/incidents',
      {
        headers: { 'x-csrf-token': csrf! },
        data: {
          typeCode: 'nat.hydro.flood',
          severity: 2,
          occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          location: { longitude: 68.787, latitude: 38.559 },
          description: 'E2E registry realtime',
          source: 'phone',
          dead: 0,
          injured: 0,
          evacuated: 0,
          affected: 0,
        },
      },
    );
    expect(createdResponse.ok()).toBeTruthy();
    const created = (await createdResponse.json()) as { id: string; number: string };
    await expect(page.getByText(created.number)).toBeVisible();

    const defaultReport = await otherContext.request.post(
      `http://localhost:5173/api/v1/incidents/${created.id}/reports`,
      { headers: { 'x-csrf-token': csrf! }, data: { injured: 3 } },
    );
    expect(defaultReport.ok()).toBeTruthy();
    const backdatedReport = await otherContext.request.post(
      `http://localhost:5173/api/v1/incidents/${created.id}/reports`,
      {
        headers: { 'x-csrf-token': csrf! },
        data: { reportedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), injured: 1 },
      },
    );
    expect(backdatedReport.status()).toBe(422);
    const detailResponse = await otherContext.request.get(
      `http://localhost:5173/api/v1/incidents/${created.id}`,
    );
    expect(detailResponse.ok()).toBeTruthy();
    expect(((await detailResponse.json()) as { injured: number }).injured).toBe(3);

    const futureResponse = await otherContext.request.post(
      'http://localhost:5173/api/v1/incidents',
      {
        headers: { 'x-csrf-token': csrf! },
        data: {
          typeCode: 'nat.hydro.flood',
          severity: 2,
          occurredAt: '2999-01-01T00:00:00.000Z',
          location: { longitude: 68.787, latitude: 38.559 },
          source: 'phone',
          dead: 0,
          injured: 0,
          evacuated: 0,
          affected: 0,
        },
      },
    );
    expect(futureResponse.status()).toBe(422);
  } finally {
    await otherContext.close();
  }
});
