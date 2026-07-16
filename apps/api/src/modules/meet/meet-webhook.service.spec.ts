import { describe, expect, it } from 'vitest';
import type { WebhookEvent } from 'livekit-server-sdk';
import { MeetWebhookService } from './meet-webhook.service';

const event = (name: string, id = 'e1'): WebhookEvent => ({ event: name, id }) as WebhookEvent;

describe('MeetWebhookService', () => {
  const svc = new MeetWebhookService();

  it('acknowledges every known lifecycle event', () => {
    const names = [
      'room_started',
      'room_finished',
      'participant_joined',
      'participant_left',
      'participant_connection_aborted',
      'track_published',
      'track_unpublished',
      'egress_started',
      'egress_updated',
      'egress_ended',
    ];
    for (const name of names) {
      expect(svc.handle(event(name))).toEqual({ event: name, handled: true });
    }
  });

  it('acknowledges an unknown event without throwing', () => {
    expect(svc.handle(event('some_future_event'))).toEqual({
      event: 'some_future_event',
      handled: false,
    });
  });
});
