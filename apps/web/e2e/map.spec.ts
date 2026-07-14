import { expect, test } from '@playwright/test';

// `window.__cuksMap` (the dev/e2e handle on the MapLibre instance) is declared by
// MapView; only the pulse-write counter this spec installs is extra.
declare global {
  interface Window {
    __incidentPulseWrites?: number;
  }
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dushanbeToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dushanbe',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dushanbeEpoch(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor((Date.UTC(year!, month! - 1, day!) - 5 * 60 * 60 * 1000) / 1000);
}

function formatDateRu(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

// Runs in the `authed` project (admin session from global-setup). Smoke-tests the
// map explorer (docs/modules/10 §4): the map mounts, the layer panel and basemap
// switcher render, a layer toggles, and zoom-to-layer is reachable.
//
// Requires the Martin tile server (docker `martin`, host port 3001) to be up —
// the page probes `/tiles/catalog` before rendering. Same infra prerequisite as
// the files specs (MinIO).
test('map screen: layers panel, basemap switcher, and layer toggle', async ({ page }) => {
  await page.goto('/app/map');

  // Map container mounts and the layer panel is present (catalog loaded).
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByText('Слои', { exact: true })).toBeVisible();
  await expect(page.getByText('Оперативная обстановка', { exact: true })).toBeVisible();
  await expect(page.getByText('Чрезвычайные ситуации', { exact: true })).toBeVisible();

  // Default-visible system layer is checked; toggling flips it.
  const adminUnits = page.getByRole('checkbox', { name: 'Административные границы' });
  await expect(adminUnits).toBeChecked();
  await adminUnits.click();
  await expect(adminUnits).not.toBeChecked();

  // Zoom-to-layer control is reachable.
  await expect(
    page.getByRole('button', { name: /Приблизить к слою «Административные границы»/ }),
  ).toBeVisible();

  // Basemap switcher opens and offers the dark basemap.
  await page.getByRole('button', { name: 'Подложка' }).click();
  await expect(page.getByRole('button', { name: 'Тёмная' })).toBeVisible();
});

test('incident layer: API options, clustered render, filters, and timeline playback', async ({
  page,
}) => {
  // Longest spec in the suite (tiles, cluster zoom, timeline playback). 60s was
  // enough standalone but not under `fullyParallel`, where the workers share one
  // dev server and tile server — it timed out waiting for the map to go idle.
  test.setTimeout(120_000);
  await page.goto('/app/map');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  const optionsResponse = await page.request.get('/api/v1/gis/incidents/filter-options');
  expect(optionsResponse.ok()).toBeTruthy();
  const options = (await optionsResponse.json()) as {
    types: Array<{ code: string }>;
    regions: Array<{ id: string; code: string }>;
  };
  expect(options.types.length).toBeGreaterThan(0);
  expect(options.regions.length).toBeGreaterThan(0);
  const regionId = options.regions.find((region) => region.code === 'TJ-DU')?.id;
  expect(regionId).toBeTruthy();

  await page.waitForFunction(() => {
    const map = window.__cuksMap;
    return map?.isStyleLoaded() === true;
  });
  await page.getByRole('button', { name: 'Свернуть панель' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = window.__cuksMap;
        return map?.queryRenderedFeatures({ layers: ['incidents-clusters'] }).length ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = window.__cuksMap;
        const clusters = map?.queryRenderedFeatures({ layers: ['incidents-cluster-count'] }) ?? [];
        return clusters.some((feature) =>
          map?.hasImage(`incident-cluster-count-${feature.properties.cluster_count}`),
        );
      }),
    )
    .toBe(true);

  const clusterPoint = await page.evaluate(() => {
    const map = window.__cuksMap;
    if (!map) return null;
    const canvas = map.getCanvas();
    const candidates = map
      .queryRenderedFeatures({ layers: ['incidents-clusters'] })
      .flatMap((feature) => {
        if (feature.geometry.type !== 'Point') return [];
        const [lon, lat] = feature.geometry.coordinates;
        if (typeof lon !== 'number' || typeof lat !== 'number') return [];
        return [map.project([lon, lat])];
      });
    const point =
      candidates.find(
        (candidate) =>
          candidate.x > 60 &&
          candidate.x < canvas.clientWidth - 60 &&
          candidate.y > 90 &&
          candidate.y < canvas.clientHeight - 120,
      ) ?? candidates[0];
    return point ? { ...point, zoom: map.getZoom() } : null;
  });
  expect(clusterPoint).not.toBeNull();
  const canvasBox = await page.getByTestId('map-canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.click(canvasBox!.x + clusterPoint!.x, canvasBox!.y + clusterPoint!.y);
  await expect
    .poll(() => page.evaluate(() => window.__cuksMap?.getZoom() ?? 0))
    .toBeGreaterThan(clusterPoint!.zoom + 1.5);

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = window.__cuksMap;
        if (!map) return resolve();
        map.once('idle', resolve);
        map.jumpTo({ center: [68.787, 38.559], zoom: 12 });
      }),
  );

  const expectedStatusImages = [
    'incident-status-active-sev-3',
    'incident-status-reported-sev-3',
    'incident-status-localized-sev-3',
    'incident-status-eliminated-sev-3',
    'incident-status-closed-sev-3',
  ];
  await expect
    .poll(() =>
      page.evaluate((ids) => {
        const map = window.__cuksMap;
        return ids.every((id) => map?.hasImage(id));
      }, expectedStatusImages),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = window.__cuksMap;
        return (
          map
            ?.querySourceFeatures('incidents_mvt', { sourceLayer: 'incidents' })
            .filter((feature) => feature.properties.number === 'ЧС-E2E-001').length ?? 0
        );
      }),
    )
    .toBe(1);

  await page.getByRole('combobox', { name: 'Вид ЧС' }).selectOption('nat.hydro.flood');
  await page.getByRole('combobox', { name: 'Статус ЧС' }).selectOption('active');
  const filteredTile = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.includes('/tiles/incidents_mvt/') &&
      url.searchParams.get('status') === 'active' &&
      url.searchParams.get('type') === 'nat.hydro.flood' &&
      url.searchParams.get('region') === regionId &&
      response.status() === 200
    );
  });
  await page.getByRole('combobox', { name: 'Регион' }).selectOption(regionId!);
  await filteredTile;
  await page.waitForFunction(() => window.__cuksMap?.isSourceLoaded('incidents_mvt') === true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const features =
          window.__cuksMap?.queryRenderedFeatures({
            layers: ['incidents'],
          }) ?? [];
        return {
          count: features.length,
          valid: features.every(
            (feature) =>
              feature.properties.status === 'active' &&
              feature.properties.type_code === 'nat.hydro.flood' &&
              typeof feature.properties.region_id === 'string',
          ),
        };
      }),
    )
    .toMatchObject({ count: expect.any(Number), valid: true });
  expect(
    await page.evaluate(
      () =>
        (
          window.__cuksMap?.queryRenderedFeatures({
            layers: ['incidents'],
          }) ?? []
        ).length,
    ),
  ).toBeGreaterThan(0);

  await page.evaluate(() => {
    const map = window.__cuksMap;
    if (!map) return;
    const original = map.setPaintProperty.bind(map);
    window.__incidentPulseWrites = 0;
    // Count the pulse repaints. The cast keeps the spy on MapLibre's overloaded
    // signature without restating it.
    map.setPaintProperty = ((layerId: string, property: string, value: unknown) => {
      if (layerId === 'incidents-active-pulse') {
        window.__incidentPulseWrites = (window.__incidentPulseWrites ?? 0) + 1;
      }
      return original(layerId, property, value);
    }) as typeof map.setPaintProperty;
  });
  await expect
    .poll(() => page.evaluate(() => window.__incidentPulseWrites ?? 0))
    .toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(80);
  const reducedMotionWrites = await page.evaluate(() => window.__incidentPulseWrites ?? 0);
  await page.waitForTimeout(160);
  expect(await page.evaluate(() => window.__incidentPulseWrites ?? 0)).toBe(reducedMotionWrites);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.getByRole('button', { name: 'Показать слои' }).click();
  await page.getByRole('checkbox', { name: 'Чрезвычайные ситуации' }).click();
  await page.waitForTimeout(80);
  const hiddenLayerWrites = await page.evaluate(() => window.__incidentPulseWrites ?? 0);
  await page.waitForTimeout(160);
  expect(await page.evaluate(() => window.__incidentPulseWrites ?? 0)).toBe(hiddenLayerWrites);
  await page.getByRole('checkbox', { name: 'Чрезвычайные ситуации' }).click();
  await page.getByRole('button', { name: 'Свернуть панель' }).click();

  const timeline = page.getByTestId('incident-timeline');
  const today = dushanbeToday();
  const yesterday = shiftDate(today, -1);
  await timeline.getByLabel('Период с').fill(yesterday);
  await timeline.getByLabel('по').fill(today);
  await timeline.getByRole('button', { name: 'Запустить анимацию' }).click();
  await expect(timeline.getByRole('button', { name: 'Приостановить анимацию' })).toBeVisible();
  await expect(timeline.locator('output')).toHaveText(formatDateRu(yesterday));

  const expectedFinalTo = String(dushanbeEpoch(shiftDate(today, 1)));
  const playbackTile = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.includes('/tiles/incidents_mvt/') &&
      url.searchParams.get('to') === expectedFinalTo &&
      url.searchParams.get('status') === 'active' &&
      response.status() === 200
    );
  });
  await expect(timeline.locator('output')).toHaveText(formatDateRu(today), { timeout: 3_000 });
  await playbackTile;
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = window.__cuksMap;
        return map?.queryRenderedFeatures({ layers: ['incidents'] }).length ?? 0;
      }),
    )
    .toBeGreaterThan(0);
});

test('map controls remain inside tablet and phone viewports', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.removeItem('cuks-ui');
    localStorage.setItem('cuks-map-panel-collapsed', '1');
  });

  for (const viewport of [
    { width: 768, height: 800 },
    { width: 375, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/app/map');
    await expect(page.getByTestId('incident-filter-bar')).toBeVisible();
    await expect(page.getByTestId('incident-timeline')).toBeVisible();
    await expect(page.locator('aside').first()).toHaveCSS('width', '64px');

    const controls = [
      page.getByTestId('incident-filter-bar'),
      page.getByTestId('incident-timeline'),
      ...(await page.getByTestId('incident-filter-bar').getByRole('combobox').all()),
    ];
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test('map screen: layer panel collapses and expands', async ({ page }) => {
  await page.goto('/app/map');

  await expect(page.getByText('Слои', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Свернуть панель' }).click();
  await expect(page.getByText('Слои', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Показать слои' }).click();
  await expect(page.getByText('Слои', { exact: true })).toBeVisible();
});
