import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AccessToken } from 'livekit-server-sdk';
import { LivekitService } from './livekit.service';
import { MeetWebhookController } from './meet-webhook.controller';
import { MeetWebhookService } from './meet-webhook.service';
import type { ConfigService } from '../../config/config.service';

const KEY = 'testkey';
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

async function signWebhook(body: string): Promise<string> {
  const at = new AccessToken(KEY, SECRET, { ttl: '5m' });
  at.sha256 = createHash('sha256').update(body).digest('base64');
  return at.toJwt();
}

describe('MeetWebhookController', () => {
  it('accepts a validly signed webhook and dispatches it', async () => {
    const meet = new MeetWebhookService();
    const dispatch = vi.spyOn(meet, 'handle');
    const controller = new MeetWebhookController(new LivekitService(config()), meet);
    const body = JSON.stringify({ event: 'room_started', id: 'r1' });

    const res = await controller.webhook(body, await signWebhook(body));

    expect(res).toEqual({ received: true });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ event: 'room_started' }));
  });

  it('accepts-and-ignores when LiveKit is not configured', async () => {
    const meet = new MeetWebhookService();
    const dispatch = vi.spyOn(meet, 'handle');
    const controller = new MeetWebhookController(
      new LivekitService(config({ LIVEKIT_URL: undefined })),
      meet,
    );

    expect(await controller.webhook('{}', 'anything')).toEqual({ received: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature without dispatching', async () => {
    const meet = new MeetWebhookService();
    const dispatch = vi.spyOn(meet, 'handle');
    const controller = new MeetWebhookController(new LivekitService(config()), meet);

    await expect(
      controller.webhook(JSON.stringify({ event: 'x' }), 'Bearer bad'),
    ).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
