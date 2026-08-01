import { expect, test, type Page } from '@playwright/test';

/**
 * Dark theme across the register's screens (план СЭД, этап 11; docs/06 §8 «Тёмная тема — проверена
 * визуально»).
 *
 * A screen breaks in dark theme in exactly one way: something was painted with a literal colour
 * instead of a token, so it keeps its light-mode value while everything around it flips. The
 * result is white-on-white or black-on-black — invisible text that no functional test notices,
 * because the element is present, has the right name, and is perfectly clickable.
 *
 * So this checks the thing that actually breaks: it walks the rendered text of each screen in
 * dark theme and fails on any element whose colour matches its own background. Screenshots of
 * both themes are attached to the report as the visual record the checklist asks for.
 */
const SCREENS = [
  { path: '/app/docs', name: 'cabinet' },
  { path: '/app/docs/search?q=письмо', name: 'search' },
  { path: '/app/docs/archive', name: 'archive' },
  { path: '/app/docs/exchange', name: 'exchange' },
  { path: '/app/docs/control', name: 'control' },
  { path: '/app/docs/reports', name: 'reports' },
];

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    // The store persists under this key and applies `.dark` on hydration.
    window.localStorage.setItem(
      'cuks-theme',
      JSON.stringify({ state: { theme: value }, version: 0 }),
    );
  }, theme);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(theme === 'dark');
}

/** Elements whose own text colour equals the background actually painted behind them. */
async function invisibleText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (value: string): [number, number, number, number] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(value);
      if (!m || !m[1]) return null;
      const parts = m[1].split(',').map((p) => Number.parseFloat(p.trim()));
      const [r, g, b, a] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
      return [r, g, b, a];
    };
    /** The nearest ancestor that actually paints something. */
    const paintedBackground = (el: Element): [number, number, number, number] => {
      for (let cur: Element | null = el; cur; cur = cur.parentElement) {
        const bg = parse(getComputedStyle(cur).backgroundColor);
        if (bg && bg[3] > 0.9) return bg;
      }
      return [255, 255, 255, 1];
    };
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
      );
      if (!own) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
        continue;
      }
      const fg = parse(style.color);
      if (!fg || fg[3] < 0.1) continue;
      const bg = paintedBackground(el);
      const distance = Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]);
      // Sum-of-channels distance. A literal colour surviving the theme flip lands at 0–20;
      // anything legible is far above it.
      if (distance < 24) {
        bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
      }
    }
    return bad;
  });
}

test('dark theme: the legibility check can actually fail', async ({ page }) => {
  // Guards every assertion below. A detector that finds nothing looks identical to a codebase
  // with nothing to find, and the second reading is the one everybody takes.
  await page.goto('/app/docs');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(await invisibleText(page)).toEqual([]);

  await page.evaluate(() => {
    const el = document.createElement('div');
    el.textContent = 'НЕВИДИМЫЙ';
    el.style.color = 'rgb(255, 255, 255)';
    el.style.backgroundColor = 'rgb(255, 255, 255)';
    document.body.appendChild(el);
  });
  expect(await invisibleText(page)).toContain('div "НЕВИДИМЫЙ"');
});

for (const screen of SCREENS) {
  test(`dark theme: ${screen.name} stays legible`, async ({ page }, testInfo) => {
    await page.goto(screen.path);
    await expect(page.getByRole('main')).toBeVisible();

    await setTheme(page, 'dark');
    await expect(page.getByRole('main')).toBeVisible();
    // Let the lists settle — a skeleton is not what we came to look at.
    await page.waitForLoadState('networkidle');

    await testInfo.attach(`${screen.name}-dark.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    expect(await invisibleText(page), 'text painted the same colour as its background').toEqual([]);

    await setTheme(page, 'light');
    await page.waitForLoadState('networkidle');
    await testInfo.attach(`${screen.name}-light.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    expect(await invisibleText(page), 'light theme, same check').toEqual([]);
  });
}
