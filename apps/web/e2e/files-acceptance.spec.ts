import { expect, test } from '@playwright/test';
import { E2E_USER, E2E_USER2 } from './support/fixtures';
import { apiLogin, csrfHeaders } from './support/api';

/**
 * Phase-1 acceptance e2e (docs/modules/12 §9, task 1.9): access control,
 * versions, and trash restore. Runs in the `authed` project (the UI specs reuse
 * the admin session; the permission spec logs in its own API contexts).
 *
 * EICAR/infected blocking is covered by task 1.3 (live ClamAV verdict + unit tests
 * for the `infected` download-block branch); ClamAV has no arm64 image and the
 * worker isn't part of the e2e stack, so it isn't re-driven here.
 */

test('permissions: a non-member is 403 and a viewer cannot upload (§9)', async () => {
  // Two plain users (no superadmin, whose access bypass would defeat the 403s). The
  // owner manages their own personal folders; `other` is the viewer / non-member.
  const owner = await apiLogin(E2E_USER.username, E2E_USER.password);
  const other = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const ownerHdr = await csrfHeaders(owner);
  const otherHdr = await csrfHeaders(other);
  const ts = Date.now();
  try {
    // Resolve `other`'s id via the directory (for the ACL grant subject).
    const dir = await owner.get(`/api/v1/directory/users?q=${E2E_USER2.username}`);
    expect(dir.ok()).toBeTruthy();
    const otherId = ((await dir.json()) as { id: string; username: string }[]).find(
      (u) => u.username === E2E_USER2.username,
    )?.id;
    expect(otherId, 'resolved e2e_user2 id').toBeTruthy();

    // Folder A — not shared: the non-member gets 403 on direct access by id.
    const aRes = await owner.post('/api/v1/files/folders', {
      headers: ownerHdr,
      data: { space: 'personal', name: `e2e-priv-${ts}` },
    });
    expect(aRes.ok()).toBeTruthy();
    const folderA = ((await aRes.json()) as { id: string }).id;
    const getA = await other.get(`/api/v1/files/${folderA}`);
    expect(getA.status()).toBe(403);
    // Assert the access-denied code (not a CSRF/origin 403) so the test can only
    // pass on real access enforcement.
    expect(((await getA.json()) as { error: { code: string } }).error.code).toBe(
      'files.node.access_denied',
    );

    // Folder B — shared viewer: `other` can view but not upload (upload needs editor).
    const bRes = await owner.post('/api/v1/files/folders', {
      headers: ownerHdr,
      data: { space: 'personal', name: `e2e-shared-${ts}` },
    });
    const folderB = ((await bRes.json()) as { id: string }).id;
    const grant = await owner.put(`/api/v1/files/${folderB}/acl`, {
      headers: ownerHdr,
      data: { subjectType: 'user', subjectId: otherId, level: 'viewer' },
    });
    expect(grant.ok()).toBeTruthy();
    expect((await other.get(`/api/v1/files/${folderB}`)).ok()).toBeTruthy(); // viewer can see
    const upload = await other.post('/api/v1/files/uploads', {
      headers: otherHdr,
      data: { space: 'personal', parentId: folderB, name: 'x.txt', mime: 'text/plain', size: 10 },
    });
    expect(upload.status(), 'viewer cannot initiate an upload').toBe(403);
    // Access-denied, not a CSRF 403 — proves the editor-level check, not just "some 403".
    expect(((await upload.json()) as { error: { code: string } }).error.code).toBe(
      'files.node.access_denied',
    );

    // Cleanup (into trash — enough for a clean listing).
    await owner.delete(`/api/v1/files/${folderA}`, { headers: ownerHdr });
    await owner.delete(`/api/v1/files/${folderB}`, { headers: ownerHdr });
  } finally {
    await owner.dispose();
    await other.dispose();
  }
});

test('versions: re-uploading the same name adds a version, and restore works (§9)', async ({
  page,
}) => {
  await page.goto('/app/files');
  const name = `ver-${Date.now()}.txt`;
  const upload = (body: string): Promise<void> =>
    page
      .getByTestId('files-file-input')
      .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(body) });

  await upload('first revision');
  await expect(page.locator('table').getByText(name)).toBeVisible({ timeout: 20_000 });

  // Same name again → duplicate prompt → confirm "upload as a new version".
  await upload('second revision, longer body');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Загрузить как версию' }).click();

  // Open the inspector, Versions tab → two versions present.
  await page.locator('table').getByText(name).click();
  await page.getByRole('button', { name: 'Версии', exact: true }).click();
  await expect(page.getByText('Версия 2')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Версия 1')).toBeVisible();

  // "Сделать текущей" on the older version → a new current version (3) appears.
  await page.getByRole('button', { name: 'Сделать текущей' }).first().click();
  await expect(page.getByText('Версия 3')).toBeVisible({ timeout: 15_000 });
});

test('trash: a deleted file restores back to My files (§9)', async ({ page }) => {
  await page.goto('/app/files');
  const name = `trash-${Date.now()}.txt`;
  await page
    .getByTestId('files-file-input')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('to be trashed') });
  await expect(page.locator('table').getByText(name)).toBeVisible({ timeout: 20_000 });

  // Clear the progress dock so the filename is unique in the DOM for the trash checks.
  const clearDock = page.getByRole('button', { name: 'Очистить', exact: true });
  if (await clearDock.count()) await clearDock.click();

  // Trash it via the row menu + confirm dialog.
  await page.locator('table tr', { hasText: name }).getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'В корзину' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'В корзину' }).click();
  await expect(page.locator('table').getByText(name)).toHaveCount(0);

  // Restore it from the Trash section.
  await page.getByRole('button', { name: 'Корзина' }).click();
  const trashRow = page.getByText(name);
  await expect(trashRow).toBeVisible({ timeout: 10_000 });
  await trashRow.locator('xpath=..').getByRole('button', { name: 'Восстановить' }).click();

  // Back in My files.
  await page.getByRole('button', { name: 'Мои файлы' }).click();
  await expect(page.locator('table').getByText(name)).toBeVisible({ timeout: 10_000 });
});
