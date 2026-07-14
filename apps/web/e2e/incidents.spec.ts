import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_DUTY, E2E_USER } from './support/fixtures';

// These scenarios share the GIS broadcast room; serial execution keeps the
// `revision=1` assertion tied to the incident created by this exact test.
test.describe.configure({ mode: 'serial' });

interface MapDiagnosticFeature {
  properties: Record<string, string | number | null>;
}

interface MapDiagnostic {
  isSourceLoaded(id: string): boolean;
  isStyleLoaded(): boolean;
  jumpTo(options: { center: [number, number]; zoom: number }): void;
  once(event: string, callback: () => void): void;
  queryRenderedFeatures(options: { layers: string[] }): MapDiagnosticFeature[];
}

type MapDiagnosticWindow = Window & {
  __cuksMap?: MapDiagnostic;
  __cuksSocket?: { connected: boolean; disconnect(): void };
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

  await page.getByRole('button', { name: 'Изменить статус' }).click();
  await expect(page.locator('#incident-status-target')).toHaveValue('active');
  await page.getByTestId('incident-status-submit').click();
  await expect(page.getByTestId('incident-current-status')).toContainText('В работе');

  await page.getByRole('button', { name: 'Изменить статус' }).click();
  await page.locator('#incident-status-target').selectOption('reported');
  await expect(page.getByTestId('incident-status-submit')).toBeDisabled();
  await page.locator('#incident-status-reason').fill('E2E повторная проверка исходных данных');
  await page.getByTestId('incident-status-submit').click();
  await expect(page.getByTestId('incident-current-status')).toContainText('Донесение');
  await page.getByRole('tab', { name: 'Хронология' }).click();
  await expect(page.getByText('E2E повторная проверка исходных данных')).toBeVisible();
});

test('stale status command keeps the dialog pending until the card is refreshed', async ({
  context,
  page,
}) => {
  const csrf = (await context.cookies()).find((cookie) => cookie.name === 'cuks_csrf')?.value;
  expect(csrf).toBeTruthy();
  const createdResponse = await page.request.post('/api/v1/incidents', {
    headers: { 'x-csrf-token': csrf! },
    data: {
      typeCode: 'nat.hydro.flood',
      severity: 2,
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      location: { longitude: 68.787, latitude: 38.559 },
      description: 'E2E stale status dialog',
      source: 'phone',
      dead: 0,
      injured: 0,
      evacuated: 0,
      affected: 0,
    },
  });
  expect(createdResponse.ok()).toBeTruthy();
  const created = (await createdResponse.json()) as { id: string };

  await page.goto(`/app/incidents/${created.id}`);
  await expect(page.getByTestId('incident-current-status')).toContainText('Донесение');
  await page.getByRole('button', { name: 'Изменить статус' }).click();
  const target = page.locator('#incident-status-target');
  const submit = page.getByTestId('incident-status-submit');
  await expect(target).toHaveValue('active');

  // Keep this page deliberately stale: the status is advanced through the API,
  // while the dialog remains open with expectedStatus=reported.
  await page.evaluate(() => (window as MapDiagnosticWindow).__cuksSocket?.disconnect());
  const externalAdvance = await page.request.post(`/api/v1/incidents/${created.id}/status`, {
    headers: { 'x-csrf-token': csrf! },
    data: { expectedStatus: 'reported', status: 'active' },
  });
  expect(externalAdvance.status()).toBe(200);

  let signalDetailRefetch: (() => void) | undefined;
  let releaseDetailRefetch: (() => void) | undefined;
  const detailRefetchStarted = new Promise<void>((resolve) => {
    signalDetailRefetch = resolve;
  });
  const detailRefetchGate = new Promise<void>((resolve) => {
    releaseDetailRefetch = resolve;
  });
  await page.route(`**/api/v1/incidents/${created.id}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    signalDetailRefetch?.();
    await detailRefetchGate;
    await route.continue();
  });

  const staleResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/v1/incidents/${created.id}/status`),
  );
  await submit.click();
  const staleResponse = await staleResponsePromise;
  expect(staleResponse.status()).toBe(409);
  await detailRefetchStarted;
  // Let React process the rejected command. The mutation must still be pending
  // because its onSettled callback awaits this held invalidation request.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(submit).toBeDisabled();

  releaseDetailRefetch?.();
  await expect(page.getByRole('alert')).toContainText(
    'Статус уже изменён другим пользователем. Данные карточки обновлены.',
  );
  await expect(page.getByTestId('incident-current-status')).toContainText('В работе');
  await expect(target).toHaveValue('localized');
  await expect(submit).toBeEnabled();
});

test('incident matrix notifies a duty officer in realtime and deep-links to the card', async ({
  browser,
  context,
  page,
}) => {
  const dutyApi = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
  const dutyContext = await browser.newContext({
    baseURL: 'http://localhost:5173',
    storageState: await dutyApi.storageState(),
  });
  const dutyPage = await dutyContext.newPage();
  try {
    await dutyPage.goto('/app/notifications');
    await dutyPage.waitForFunction(
      () => (window as MapDiagnosticWindow).__cuksSocketReady === true,
    );

    const csrf = (await context.cookies()).find((cookie) => cookie.name === 'cuks_csrf')?.value;
    expect(csrf).toBeTruthy();
    const createdResponse = await page.request.post('/api/v1/incidents', {
      headers: { 'x-csrf-token': csrf! },
      data: {
        typeCode: 'nat.hydro.flood',
        severity: 2,
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        location: { longitude: 68.787, latitude: 38.559 },
        description: 'E2E incident notification matrix',
        source: 'phone',
        dead: 0,
        injured: 0,
        evacuated: 0,
        affected: 0,
      },
    });
    expect(createdResponse.ok()).toBeTruthy();
    const created = (await createdResponse.json()) as { id: string; number: string };

    await expect(dutyPage.getByText(created.number).first()).toBeVisible();
    await expect(dutyPage.getByText('Уровень ЧС: 2').first()).toBeVisible();
    const feedResponse = await dutyApi.get('/api/v1/notifications?group=incidents&limit=20');
    expect(feedResponse.ok()).toBeTruthy();
    const feed = (await feedResponse.json()) as { items: { entityId: string }[] };
    expect(feed.items.filter((item) => item.entityId === created.id)).toHaveLength(1);

    await dutyPage.getByText(created.number).first().click();
    await dutyPage.waitForURL(`/app/incidents/${created.id}`);

    const selfResponse = await dutyApi.post('/api/v1/incidents', {
      headers: await csrfHeaders(dutyApi),
      data: {
        typeCode: 'nat.hydro.flood',
        severity: 2,
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        location: { longitude: 68.79, latitude: 38.56 },
        description: 'E2E self notification matrix',
        source: 'phone',
        dead: 0,
        injured: 0,
        evacuated: 0,
        affected: 0,
      },
    });
    expect(selfResponse.ok()).toBeTruthy();
    const selfCreated = (await selfResponse.json()) as { id: string; number: string };
    const selfFeedResponse = await dutyApi.get('/api/v1/notifications?group=incidents&limit=20');
    const selfFeed = (await selfFeedResponse.json()) as { items: { entityId: string }[] };
    expect(selfFeed.items.filter((item) => item.entityId === selfCreated.id)).toHaveLength(1);
    await dutyPage.goto('/app/notifications');
    await expect(dutyPage.getByText(selfCreated.number).first()).toBeVisible();
  } finally {
    await dutyPage.close();
    await dutyContext.close();
    await dutyApi.dispose();
  }
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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (window as MapDiagnosticWindow).__cuksMap;
        if (!map) return resolve();
        map.once('idle', resolve);
        map.jumpTo({ center: [68.787, 38.559], zoom: 12 });
      }),
  );

  const csrf = (await context.cookies()).find((cookie) => cookie.name === 'cuks_csrf')?.value;
  expect(csrf).toBeTruthy();
  const refreshedTile = page.waitForResponse(
    (tileResponse) => {
      const url = new URL(tileResponse.url());
      return (
        url.pathname.includes('/tiles/incidents_mvt/') &&
        url.searchParams.get('revision') === '1' &&
        tileResponse.status() === 200
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
  const created = (await response.json()) as { id: string };
  await refreshedTile;

  const statusTile = page.waitForResponse(
    (tileResponse) => {
      const url = new URL(tileResponse.url());
      return (
        url.pathname.includes('/tiles/incidents_mvt/') &&
        url.searchParams.get('revision') === '2' &&
        tileResponse.status() === 200
      );
    },
    { timeout: 15_000 },
  );
  const statusResponse = await page.request.post(`/api/v1/incidents/${created.id}/status`, {
    headers: { 'x-csrf-token': csrf! },
    data: { expectedStatus: 'reported', status: 'active' },
  });
  expect(statusResponse.status()).toBe(200);
  await statusTile;
  await page.waitForFunction(
    () => (window as MapDiagnosticWindow).__cuksMap?.isSourceLoaded('incidents_mvt') === true,
  );
  await expect
    .poll(() =>
      page.evaluate((incidentId) => {
        const features =
          (window as MapDiagnosticWindow).__cuksMap?.queryRenderedFeatures({
            layers: ['incidents'],
          }) ?? [];
        return features.some(
          (feature) =>
            feature.properties.feature_id === incidentId && feature.properties.status === 'active',
        );
      }, created.id),
    )
    .toBe(true);
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
          // Dated now, not in the past: the registry shows 25 rows sorted by
          // -occurredAt, so on a dev database that has accumulated incidents from
          // earlier runs a backdated one lands on page 2 and this assertion — about
          // the realtime refresh, not about dates — fails for the wrong reason.
          occurredAt: new Date().toISOString(),
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

    const invalidStatus = await otherContext.request.post(
      `http://localhost:5173/api/v1/incidents/${created.id}/status`,
      {
        headers: { 'x-csrf-token': csrf! },
        data: { expectedStatus: 'reported', status: 'localized' },
      },
    );
    expect(invalidStatus.status()).toBe(422);

    const [firstStatus, staleStatus] = await Promise.all([
      otherContext.request.post(`http://localhost:5173/api/v1/incidents/${created.id}/status`, {
        headers: { 'x-csrf-token': csrf! },
        data: { expectedStatus: 'reported', status: 'active' },
      }),
      otherContext.request.post(`http://localhost:5173/api/v1/incidents/${created.id}/status`, {
        headers: { 'x-csrf-token': csrf! },
        data: { expectedStatus: 'reported', status: 'active' },
      }),
    ]);
    expect([firstStatus.status(), staleStatus.status()].sort()).toEqual([200, 409]);

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

    for (const [expectedStatus, status] of [
      ['active', 'localized'],
      ['localized', 'eliminated'],
      ['eliminated', 'closed'],
    ] as const) {
      const transition = await otherContext.request.post(
        `http://localhost:5173/api/v1/incidents/${created.id}/status`,
        {
          headers: { 'x-csrf-token': csrf! },
          data: { expectedStatus, status },
        },
      );
      expect(transition.status()).toBe(200);
    }
    const closedDetail = await otherContext.request.get(
      `http://localhost:5173/api/v1/incidents/${created.id}`,
    );
    const closed = (await closedDetail.json()) as { closedAt: string | null; status: string };
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeTruthy();
    const closedReport = await otherContext.request.post(
      `http://localhost:5173/api/v1/incidents/${created.id}/reports`,
      { headers: { 'x-csrf-token': csrf! }, data: { injured: 4 } },
    );
    expect(closedReport.status()).toBe(409);
    const closedResource = await otherContext.request.post(
      `http://localhost:5173/api/v1/incidents/${created.id}/resources`,
      {
        headers: { 'x-csrf-token': csrf! },
        data: { kind: 'personnel', name: 'Late resource', qty: 1 },
      },
    );
    expect(closedResource.status()).toBe(409);
    const reopened = await otherContext.request.post(
      `http://localhost:5173/api/v1/incidents/${created.id}/status`,
      {
        headers: { 'x-csrf-token': csrf! },
        data: {
          expectedStatus: 'closed',
          status: 'active',
          reason: 'E2E response resumed',
        },
      },
    );
    expect(reopened.status()).toBe(200);
    expect(((await reopened.json()) as { closedAt: string | null }).closedAt).toBeNull();
  } finally {
    await otherContext.close();
  }
});

test('incident status endpoint rejects a user without incidents.manage', async ({ page }) => {
  const employee = await apiLogin(E2E_USER.username, E2E_USER.password);
  try {
    const list = await page.request.get('/api/v1/incidents?page=1&limit=1&sort=-occurredAt');
    const incident = ((await list.json()) as { items: { id: string; status: string }[] }).items[0];
    expect(incident).toBeTruthy();
    const response = await employee.post(`/api/v1/incidents/${incident!.id}/status`, {
      headers: await csrfHeaders(employee),
      data: { expectedStatus: incident!.status, status: 'active' },
    });
    expect(response.status()).toBe(403);
  } finally {
    await employee.dispose();
  }
});
