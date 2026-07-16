import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { LivekitService } from './livekit.service';
import type { ConfigService } from '../../config/config.service';

const KEY = 'testkey';
// HS256 requires a >= 32-byte HMAC key (RFC 7518); this matches the dev secret shape.
const SECRET = 'testsecrettestsecrettestsecrettest';

function config(over: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    LIVEKIT_URL: 'ws://localhost:7880',
    LIVEKIT_API_KEY: KEY,
    LIVEKIT_API_SECRET: SECRET,
    ...over,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

/** Build the `Authorization` header LiveKit sends: a JWT whose `sha256` claim is the
 *  base64 hash of the exact body — the same construction the SFU uses server-side. */
async function signWebhook(body: string, secret = SECRET, key = KEY): Promise<string> {
  const at = new AccessToken(key, secret, { ttl: '5m' });
  at.sha256 = createHash('sha256').update(body).digest('base64');
  return at.toJwt();
}

describe('LivekitService', () => {
  it('is enabled only when url + key + secret are all present', () => {
    expect(new LivekitService(config()).enabled).toBe(true);
    expect(new LivekitService(config({ LIVEKIT_URL: undefined })).enabled).toBe(false);
    expect(new LivekitService(config({ LIVEKIT_API_KEY: undefined })).enabled).toBe(false);
    expect(new LivekitService(config({ LIVEKIT_API_SECRET: undefined })).enabled).toBe(false);
  });

  it('throws when a webhook is received while disabled', async () => {
    const svc = new LivekitService(config({ LIVEKIT_API_SECRET: undefined }));
    await expect(svc.receiveWebhook('{}', 'anything')).rejects.toThrow('not configured');
  });

  it('rejects a webhook with a missing or garbage signature', async () => {
    const svc = new LivekitService(config());
    const body = JSON.stringify({ event: 'room_started' });
    await expect(svc.receiveWebhook(body, undefined)).rejects.toThrow();
    await expect(svc.receiveWebhook(body, 'Bearer not-a-jwt')).rejects.toThrow();
  });

  it('rejects a webhook signed with the wrong secret', async () => {
    const svc = new LivekitService(config());
    const body = JSON.stringify({ event: 'room_started' });
    const header = await signWebhook(body, 'wrongsecretwrongsecretwrongsecret!!');
    await expect(svc.receiveWebhook(body, header)).rejects.toThrow();
  });

  it('rejects a webhook whose body was tampered after signing', async () => {
    const svc = new LivekitService(config());
    const header = await signWebhook(JSON.stringify({ event: 'room_started' }));
    await expect(
      svc.receiveWebhook(JSON.stringify({ event: 'room_finished' }), header),
    ).rejects.toThrow();
  });

  it('verifies and parses a correctly signed webhook', async () => {
    const svc = new LivekitService(config());
    const body = JSON.stringify({
      event: 'participant_joined',
      participant: { identity: 'u1' },
      room: { name: 'r1' },
    });
    const event = await svc.receiveWebhook(body, await signWebhook(body));
    expect(event.event).toBe('participant_joined');
    expect(event.participant?.identity).toBe('u1');
  });

  describe('createJoinToken', () => {
    it('exposes the public SFU url', () => {
      expect(new LivekitService(config()).publicUrl).toBe('ws://localhost:7880');
    });

    it('mints a participant token scoped to the room, without room-admin', async () => {
      const svc = new LivekitService(config());
      const jwt = await svc.createJoinToken({
        room: 'meet-1',
        identity: 'u1',
        name: 'User One',
        avatar: null,
        role: 'participant',
      });
      const claims = await new TokenVerifier(KEY, SECRET).verify(jwt);
      expect(claims.sub).toBe('u1'); // identity
      expect(claims.name).toBe('User One');
      expect(claims.video?.roomJoin).toBe(true);
      expect(claims.video?.room).toBe('meet-1');
      expect(claims.video?.canPublish).toBe(true);
      expect(claims.video?.canSubscribe).toBe(true);
      expect(claims.video?.canPublishData).toBe(true);
      expect(claims.video?.roomAdmin).toBeFalsy();
      expect(JSON.parse(claims.metadata ?? '{}')).toEqual({ avatar: null, role: 'participant' });
    });

    it('grants room-admin (host powers) to a host and carries the avatar in metadata', async () => {
      const svc = new LivekitService(config());
      const jwt = await svc.createJoinToken({
        room: 'meet-1',
        identity: 'host-1',
        name: 'Host',
        avatar: 'file-9',
        role: 'host',
      });
      const claims = await new TokenVerifier(KEY, SECRET).verify(jwt);
      expect(claims.video?.roomAdmin).toBe(true);
      expect(JSON.parse(claims.metadata ?? '{}')).toEqual({ avatar: 'file-9', role: 'host' });
    });

    it('throws when LiveKit is not configured', async () => {
      const svc = new LivekitService(config({ LIVEKIT_API_KEY: undefined }));
      await expect(
        svc.createJoinToken({
          room: 'r',
          identity: 'u',
          name: 'U',
          avatar: null,
          role: 'participant',
        }),
      ).rejects.toThrow('not configured');
    });
  });
});
