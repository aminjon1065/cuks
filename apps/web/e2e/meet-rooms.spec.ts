import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_DUTY, STORAGE_STATE } from './support/fixtures';

const API = 'http://localhost:3000';

/**
 * Task 6.2 — call rooms + LiveKit join tokens (docs/modules/14 §5–§7). Proves the security core: a
 * channel call is joinable only by that channel's members (a `meet.use` holder — even a superadmin —
 * cannot read the room or mint a token for a channel they aren't in), while an ad-hoc `link` room is
 * open to any platform user. Token issuance itself needs LiveKit configured; the env-independent
 * assertions here are room creation/idempotency and the membership authorization.
 */

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function postHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}

interface RoomDto {
  id: string;
  slug: string;
  kind: string;
  channelId: string | null;
  access: string;
  isActive: boolean;
  myRole: 'host' | 'participant';
}

test('a channel call room is member-gated for reads and tokens; ad-hoc link rooms are open', async () => {
  const duty = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
  // The superadmin (pre-authed via global-setup) is the non-member: they hold meet.use through the
  // wildcard yet aren't in the duty officer's private channel — the strongest BOLA outsider.
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  try {
    const dutyPost = await postHeaders(duty);

    // The duty officer owns a private channel and opens its call room → they are the host.
    const channel = await json<{ id: string }>(
      await duty.post('/api/v1/chat/channels', {
        headers: dutyPost,
        data: { kind: 'private', name: `Meet ${Date.now()}` },
      }),
    );
    const room = await json<RoomDto>(
      await duty.post('/api/v1/meet/rooms', {
        headers: dutyPost,
        data: { kind: 'channel', channelId: channel.id },
      }),
    );
    expect(room.slug).toMatch(/^[0-9a-f]{16}$/);
    expect(room.channelId).toBe(channel.id);
    expect(room.myRole).toBe('host');
    expect(room.isActive).toBe(true);

    // Idempotent: opening again reuses the one live room for the channel.
    const again = await json<RoomDto>(
      await duty.post('/api/v1/meet/rooms', {
        headers: dutyPost,
        data: { kind: 'channel', channelId: channel.id },
      }),
    );
    expect(again.id).toBe(room.id);

    // The member can read the room by slug…
    const readAsMember = await duty.get(`/api/v1/meet/rooms/${room.slug}`);
    expect(readAsMember.status()).toBe(200);

    // …but a non-member (here a superadmin, who holds meet.use via the wildcard yet isn't in the
    // channel) is refused — membership is enforced independently of RBAC (no BOLA).
    const readAsOutsider = await admin.get(`/api/v1/meet/rooms/${room.slug}`);
    expect(readAsOutsider.status()).toBe(403);

    // Token: authorization runs before the LiveKit-configured gate, so the outsider is always 403
    // (never a 503 that would mask it); the member gets a token when LiveKit is wired, else 503.
    // Bodyless POST: csrf-only headers (a content-type: json with no body makes Fastify 400).
    const outsiderToken = await admin.post(`/api/v1/meet/rooms/${room.id}/token`, {
      headers: await csrfHeaders(admin),
    });
    expect(outsiderToken.status()).toBe(403);

    const memberToken = await duty.post(`/api/v1/meet/rooms/${room.id}/token`, {
      headers: await csrfHeaders(duty),
    });
    expect([200, 503]).toContain(memberToken.status());
    if (memberToken.status() === 200) {
      const body = await json<{ token: string; url: string }>(memberToken);
      expect(body.token.length).toBeGreaterThan(0);
      expect(body.url.length).toBeGreaterThan(0);
    }

    // An ad-hoc room is a shareable link: any platform user with meet.use can read it, member or not.
    const adhoc = await json<RoomDto>(
      await admin.post('/api/v1/meet/rooms', {
        headers: await postHeaders(admin),
        data: { kind: 'adhoc' },
      }),
    );
    expect(adhoc.access).toBe('link');
    expect(adhoc.channelId).toBeNull();
    const adhocByOther = await duty.get(`/api/v1/meet/rooms/${adhoc.slug}`);
    expect(adhocByOther.status()).toBe(200);
  } finally {
    await duty.dispose();
    await admin.dispose();
  }
});

test('host moderation is restricted to the room host', async () => {
  const duty = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  try {
    const dutyPost = await postHeaders(duty);
    const channel = await json<{ id: string }>(
      await duty.post('/api/v1/chat/channels', {
        headers: dutyPost,
        data: { kind: 'private', name: `Host ${Date.now()}` },
      }),
    );
    const room = await json<RoomDto>(
      await duty.post('/api/v1/meet/rooms', {
        headers: dutyPost,
        data: { kind: 'channel', channelId: channel.id },
      }),
    );

    // A non-host (superadmin, not the creator) cannot end or mute the call.
    const outsiderEnd = await admin.post(`/api/v1/meet/rooms/${room.id}/host/end`, {
      headers: await csrfHeaders(admin),
    });
    expect(outsiderEnd.status()).toBe(403);

    // The host can end the call — this marks the room inactive even without LiveKit wired.
    const end = await duty.post(`/api/v1/meet/rooms/${room.id}/host/end`, {
      headers: await csrfHeaders(duty),
    });
    expect(end.ok()).toBeTruthy();

    // The room is now ended: minting a token for it is refused with a conflict.
    const tokenAfterEnd = await duty.post(`/api/v1/meet/rooms/${room.id}/token`, {
      headers: await csrfHeaders(duty),
    });
    expect(tokenAfterEnd.status()).toBe(409);
  } finally {
    await duty.dispose();
    await admin.dispose();
  }
});
