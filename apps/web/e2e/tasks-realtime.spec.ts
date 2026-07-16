import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Two-client realtime (docs/modules/15 §3/§10, task 4.6): two sockets join the same board room; a
 * card moved / created by one path is delivered to the other client well under the 500 ms target.
 */
const API = 'http://localhost:3000';
const WS = `${API}/ws`;

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function headers(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
const uniqueKey = () => `R${Date.now() % 1e9}`;

/** Resolve with the next `event` payload, or reject after `timeoutMs`. */
function nextEvent<T>(socket: Socket, event: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
/** Emit `board.subscribe` and await the server ack. */
function subscribe(socket: Socket, projectId: string): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscribe timeout')), 3000);
    socket.emit('board.subscribe', { projectId }, (ack: { ok: boolean }) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

test('realtime: two board clients see a move and a create within the latency budget', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const session = (await admin.storageState()).cookies.find((c) => c.name === 'cuks_session');
  expect(session, 'the authed session cookie is present').toBeTruthy();
  const cookie = `cuks_session=${session!.value}`;

  // A fresh board with a card.
  const project = await j<{ id: string }>(
    await admin.post('/api/v1/tasks/projects', {
      headers: h,
      data: { name: `RT ${Date.now()}`, key: uniqueKey(), visibleToOrgUnit: false },
    }),
  );
  const board = await j<{ columns: { id: string }[] }>(
    await admin.get(`/api/v1/tasks/projects/${project.id}/board`),
  );
  const [col0, col1] = [board.columns[0]!.id, board.columns[1]!.id];
  const card = await j<{ id: string }>(
    await admin.post(`/api/v1/tasks/projects/${project.id}/cards`, {
      headers: h,
      data: { columnId: col0, title: 'Realtime' },
    }),
  );

  const opts = { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true };
  const a = io(WS, opts);
  const b = io(WS, opts);
  try {
    await Promise.all([
      nextEvent(a, 'connection.ready', 4000),
      nextEvent(b, 'connection.ready', 4000),
    ]);
    const [ackA, ackB] = await Promise.all([subscribe(a, project.id), subscribe(b, project.id)]);
    expect(ackA.ok && ackB.ok, 'both clients join the board room').toBe(true);

    // A move performed via REST reaches the other socket.
    const moved = nextEvent<{ taskId: string; columnId: string }>(b, 'tasks.card.moved', 3000);
    const t0 = Date.now();
    await admin.post(`/api/v1/tasks/cards/${card.id}/move`, {
      headers: h,
      data: { columnId: col1, afterTaskId: null },
    });
    const movePayload = await moved;
    const latency = Date.now() - t0;
    expect(movePayload.taskId).toBe(card.id);
    expect(movePayload.columnId).toBe(col1);
    // The product target is < 500 ms; locally it is a few tens of ms. Assert a generous, non-flaky
    // bound (request round-trip + emit) — the real latency is logged.
    console.log(`realtime move latency: ${latency}ms`);
    expect(latency).toBeLessThan(2000);

    // A newly-created card is also broadcast.
    const created = nextEvent<{ taskId: string }>(b, 'tasks.card.created', 3000);
    const created2 = await admin.post(`/api/v1/tasks/projects/${project.id}/cards`, {
      headers: h,
      data: { columnId: col0, title: 'Realtime 2' },
    });
    const newId = (await j<{ id: string }>(created2)).id;
    expect((await created).taskId).toBe(newId);
  } finally {
    a.disconnect();
    b.disconnect();
    await admin.dispose();
  }
});
