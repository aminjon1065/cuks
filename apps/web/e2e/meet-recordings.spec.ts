import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_DUTY, E2E_SUGHD } from './support/fixtures';

/**
 * Task 6.6 — recordings authorization (docs/modules/14 §4/§9). Start/stop are host-only even for a
 * user who holds meet.record; the list endpoint is scoped and unknown ids 404. The full «participant
 * can view, non-participant gets 403 on a real recording» check needs an actual egress file and is
 * covered by the manual run in 6.7 (media can't render here).
 */
async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}

test('recordings: start/stop are host-only; list is scoped; unknown id 404s', async () => {
  const duty = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
  const sughd = await apiLogin(E2E_SUGHD.username, E2E_SUGHD.password);
  try {
    const dutyH = await jsonHeaders(duty);
    const channel = await j<{ id: string }>(
      await duty.post('/api/v1/chat/channels', {
        headers: dutyH,
        data: { kind: 'private', name: `Rec ${Date.now()}` },
      }),
    );
    const room = await j<{ id: string }>(
      await duty.post('/api/v1/meet/rooms', {
        headers: dutyH,
        data: { kind: 'channel', channelId: channel.id },
      }),
    );

    // A non-host (who still holds meet.record via the duty_officer role) cannot start or stop.
    const sughdStart = await sughd.post(`/api/v1/meet/rooms/${room.id}/recording/start`, {
      headers: await jsonHeaders(sughd),
      data: {},
    });
    expect(sughdStart.status()).toBe(403);
    const sughdStop = await sughd.post(`/api/v1/meet/rooms/${room.id}/recording/stop`, {
      headers: await csrfHeaders(sughd),
    });
    expect(sughdStop.status()).toBe(403);

    // The host may start — 503 when LiveKit/egress isn't wired in this env, or 200 when it is.
    const hostStart = await duty.post(`/api/v1/meet/rooms/${room.id}/recording/start`, {
      headers: dutyH,
      data: {},
    });
    expect([200, 201, 503]).toContain(hostStart.status());

    // The list is a scoped array; deleting an unknown recording 404s.
    const list = await duty.get('/api/v1/meet/recordings');
    expect(list.status()).toBe(200);
    expect(Array.isArray(await list.json())).toBe(true);

    const del = await duty.delete(`/api/v1/meet/recordings/${randomUUID()}`, {
      headers: await csrfHeaders(duty),
    });
    expect(del.status()).toBe(404);
  } finally {
    await duty.dispose();
    await sughd.dispose();
  }
});
