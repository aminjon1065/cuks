import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Task links to ЧС and card templates (docs/modules/15 §4/§6, task 4.5). Drives the real API: a card
 * links to an incident and the link shows on both sides; create-from-ЧС makes a card already linked;
 * a template instantiates a card with its checklist.
 */
const API = 'http://localhost:3000';

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function headers(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
const uniqueKey = () => `L${Date.now() % 1e9}`;

interface Link {
  id: string;
  targetType: string;
  title: string;
}
interface Linked {
  id: string;
  seq: number;
}

test('links & templates: link a card to a ЧС (both sides), create-from-ЧС, instantiate a template', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);

  // A seeded incident to link to.
  const incidents = await j<{ items: { id: string }[] }>(
    await admin.get('/api/v1/incidents?page=1&limit=5'),
  );
  expect(incidents.items.length, 'the e2e seed provides incidents').toBeGreaterThan(0);
  const incidentId = incidents.items[0]!.id;

  // A fresh project + card.
  const project = await j<{ id: string; key: string }>(
    await admin.post('/api/v1/tasks/projects', {
      headers: h,
      data: { name: `Links ${Date.now()}`, key: uniqueKey(), visibleToOrgUnit: false },
    }),
  );
  const board = await j<{ columns: { id: string }[] }>(
    await admin.get(`/api/v1/tasks/projects/${project.id}/board`),
  );
  const col = board.columns[0]!.id;
  const card = await j<{ id: string; seq: number }>(
    await admin.post(`/api/v1/tasks/projects/${project.id}/cards`, {
      headers: h,
      data: { columnId: col, title: 'Связанная задача' },
    }),
  );

  // Link the card to the incident.
  const links = await j<Link[]>(
    await admin.post(`/api/v1/tasks/cards/${card.id}/links`, {
      headers: h,
      data: { targetType: 'incident', targetId: incidentId },
    }),
  );
  expect(links).toHaveLength(1);
  expect(links[0]!.targetType).toBe('incident');
  expect(links[0]!.title.startsWith('ЧС')).toBe(true);

  // The link shows on the incident side too («связь видна с обеих сторон»).
  const fromIncident = async () =>
    j<Linked[]>(await admin.get(`/api/v1/tasks/linked/incident/${incidentId}`));
  expect((await fromIncident()).map((l) => l.id)).toContain(card.id);

  // «Создать задачу» from the ЧС — a card created already linked.
  const linkedCard = await j<{ id: string }>(
    await admin.post('/api/v1/tasks/cards/linked', {
      headers: h,
      data: {
        projectId: project.id,
        columnId: col,
        title: 'Из ЧС',
        targetType: 'incident',
        targetId: incidentId,
      },
    }),
  );
  const ids = (await fromIncident()).map((l) => l.id);
  expect(ids).toContain(card.id);
  expect(ids).toContain(linkedCard.id);

  // Removing the link drops the card from the incident's list.
  await admin.delete(`/api/v1/tasks/cards/${card.id}/links/${links[0]!.id}`, {
    headers: await csrfHeaders(admin),
  });
  expect((await fromIncident()).map((l) => l.id)).not.toContain(card.id);

  // A template instantiates a card seeded with its checklist.
  const tpl = await j<{ id: string }>(
    await admin.post(`/api/v1/tasks/projects/${project.id}/templates`, {
      headers: h,
      data: {
        name: 'Отработка ЧС',
        title: 'Отработка донесения',
        checklist: ['Принять', 'Доложить'],
      },
    }),
  );
  const madeCard = await j<{ id: string }>(
    await admin.post(`/api/v1/tasks/projects/${project.id}/templates/${tpl.id}/card`, {
      headers: h,
      data: { columnId: col },
    }),
  );
  const detail = await j<{ title: string; checklist: { text: string }[] }>(
    await admin.get(`/api/v1/tasks/cards/${madeCard.id}`),
  );
  expect(detail.title).toBe('Отработка донесения');
  expect(detail.checklist.map((i) => i.text)).toEqual(['Принять', 'Доложить']);

  await admin.dispose();
});
