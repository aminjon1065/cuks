import { expect, test } from '@playwright/test';
import { apiLogin } from './support/api';
import { E2E_DUTY, E2E_SUGHD } from './support/fixtures';

/**
 * Territory scoping (task 2.13, docs/05 §11c): a user whose role is bound to a
 * regional department sees only that region's incidents — in the registry list and
 * on a direct fetch by id — while a global (central) user sees all. e2e_duty is a
 * globally-scoped duty officer; e2e_sughd is the same role bound to Sughd. Both hold
 * gis.view and neither is 2FA-gated, so password-only apiLogin authenticates them.
 * The seed provisions incidents in both Sughd and Khatlon.
 */
interface IncidentListItem {
  id: string;
  number: string;
  regionName: string | null;
}
interface IncidentList {
  items: IncidentListItem[];
  total: number;
}

async function listAll(
  ctx: Awaited<ReturnType<typeof apiLogin>>,
  query = '',
): Promise<IncidentListItem[]> {
  const res = await ctx.get(`/api/v1/incidents?limit=200${query}`);
  expect(res.ok(), `list incidents failed (${res.status()})`).toBeTruthy();
  return ((await res.json()) as IncidentList).items;
}

test.describe('territory-scoped incident access', () => {
  test('a Sughd-bound user sees Sughd incidents and never Khatlon', async () => {
    const central = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
    const sughd = await apiLogin(E2E_SUGHD.username, E2E_SUGHD.password);

    // The global (central) user sees both regions' fixtures.
    const centralItems = await listAll(central);
    const centralNumbers = new Set(centralItems.map((i) => i.number));
    expect(centralNumbers.has('ЧС-E2E-SU-001')).toBeTruthy();
    expect(centralNumbers.has('ЧС-E2E-KT-001')).toBeTruthy();

    // The scoped user's list is confined to Sughd: every row is Sughd, and the
    // Khatlon fixtures are absent entirely.
    const sughdItems = await listAll(sughd);
    expect(sughdItems.length).toBeGreaterThan(0);
    for (const item of sughdItems) {
      expect(item.number.startsWith('ЧС-E2E-KT-'), `leaked Khatlon: ${item.number}`).toBeFalsy();
    }
    const sughdNumbers = new Set(sughdItems.map((i) => i.number));
    expect(sughdNumbers.has('ЧС-E2E-SU-001')).toBeTruthy();
    expect(sughdNumbers.has('ЧС-E2E-KT-001')).toBeFalsy();
    expect(sughdNumbers.has('ЧС-E2E-KT-002')).toBeFalsy();

    // A direct fetch of a Khatlon incident by id is a 404 (out of scope, not merely
    // hidden from the list) — the id is real, discovered via the central user's list.
    const khatlon = centralItems.find((i) => i.number === 'ЧС-E2E-KT-001');
    expect(khatlon, 'central user should see the Khatlon fixture').toBeTruthy();
    const forbidden = await sughd.get(`/api/v1/incidents/${khatlon!.id}`);
    expect(forbidden.status()).toBe(404);

    // …while the same fetch of a Sughd incident succeeds for the scoped user.
    const sughdIncident = sughdItems.find((i) => i.number === 'ЧС-E2E-SU-001');
    const ok = await sughd.get(`/api/v1/incidents/${sughdIncident!.id}`);
    expect(ok.ok()).toBeTruthy();

    await central.dispose();
    await sughd.dispose();
  });
});
