import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_DUTY, E2E_SUGHD } from './support/fixtures';

/**
 * Task 6.4 — 1:1 call ring-flow (docs/modules/14 §2). The DM caller opens the room and rings the other
 * member; only the room owner may ring; a decline (like the 30 s «no answer» timeout — same handler)
 * posts a `kind: 'call'` card into the DM. (The realtime `meet.ring` delivery + ringtone are covered by
 * the manual run in 6.7.)
 */
async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}

interface RoomDto {
  id: string;
  slug: string;
  channelId: string | null;
}

test('ring: only the owner can ring, and a decline posts a call card to the DM', async () => {
  const duty = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
  const sughd = await apiLogin(E2E_SUGHD.username, E2E_SUGHD.password);
  try {
    const dutyMe = await j<{ id: string }>(await duty.get('/api/auth/me'));
    const sughdMe = await j<{ id: string }>(await sughd.get('/api/auth/me'));
    const dutyH = await jsonHeaders(duty);

    // A DM between the two, and its call room (duty is the host/owner).
    const dm = await j<{ id: string }>(
      await duty.post('/api/v1/chat/channels/dm', {
        headers: dutyH,
        data: { userIds: [sughdMe.id] },
      }),
    );
    const room = await j<RoomDto>(
      await duty.post('/api/v1/meet/rooms', {
        headers: dutyH,
        data: { kind: 'dm', channelId: dm.id },
      }),
    );

    // The owner rings the other member.
    const ring = await duty.post('/api/v1/meet/ring', {
      headers: dutyH,
      data: { roomId: room.id, userId: sughdMe.id, media: 'video' },
    });
    expect(ring.ok()).toBeTruthy();

    // A non-owner cannot ring for this room.
    const badRing = await sughd.post('/api/v1/meet/ring', {
      headers: await jsonHeaders(sughd),
      data: { roomId: room.id, userId: dutyMe.id, media: 'audio' },
    });
    expect(badRing.status()).toBe(403);

    // The recipient declines → a call card appears in the DM feed.
    const decline = await sughd.post(`/api/v1/meet/ring/${room.id}/decline`, {
      headers: await csrfHeaders(sughd),
    });
    expect(decline.ok()).toBeTruthy();

    const hasCallCard = async (): Promise<boolean> => {
      const page = await j<{ items: { kind: string }[] }>(
        await duty.get(`/api/v1/chat/channels/${dm.id}/messages`),
      );
      return page.items.some((m) => m.kind === 'call');
    };
    await expect.poll(hasCallCard, { timeout: 8000 }).toBe(true);
  } finally {
    await duty.dispose();
    await sughd.dispose();
  }
});
