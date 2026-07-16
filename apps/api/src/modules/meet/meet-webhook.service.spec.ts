import { describe, expect, it, vi } from 'vitest';
import type { WebhookEvent } from 'livekit-server-sdk';
import type { Database } from '@cuks/db';
import { MeetWebhookService } from './meet-webhook.service';
import type { RealtimeService } from '../events/realtime.service';

const event = (name: string, extra: Partial<WebhookEvent> = {}): WebhookEvent =>
  ({ event: name, id: 'e1', ...extra }) as WebhookEvent;

/** A drizzle `update().set().where().returning()` chain that resolves to `rows`. */
function stubDb(rows: unknown[]): Database {
  return {
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }),
    }),
  } as unknown as Database;
}
function stubRealtime(): RealtimeService & { emitToRoom: ReturnType<typeof vi.fn> } {
  return { emitToRoom: vi.fn() } as unknown as RealtimeService & {
    emitToRoom: ReturnType<typeof vi.fn>;
  };
}

describe('MeetWebhookService', () => {
  it('acknowledges every known lifecycle event', async () => {
    const svc = new MeetWebhookService(stubDb([]), stubRealtime());
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
      expect(await svc.handle(event(name))).toEqual({ event: name, handled: true });
    }
  });

  it('acknowledges an unknown event without throwing', async () => {
    const svc = new MeetWebhookService(stubDb([]), stubRealtime());
    expect(await svc.handle(event('some_future_event'))).toEqual({
      event: 'some_future_event',
      handled: false,
    });
  });

  it('retires the room and drops the channel banner when the SFU room finishes', async () => {
    const realtime = stubRealtime();
    const svc = new MeetWebhookService(stubDb([{ id: 'room-1', channelId: 'chan-1' }]), realtime);
    await svc.handle(
      event('room_finished', { room: { name: 'meet-room-1' } } as Partial<WebhookEvent>),
    );
    expect(realtime.emitToRoom).toHaveBeenCalledWith('channel:chan-1', 'meet.room.updated', {
      channelId: 'chan-1',
      roomId: 'room-1',
      active: false,
    });
  });

  it('does not emit a banner update for an ad-hoc (channel-less) room', async () => {
    const realtime = stubRealtime();
    const svc = new MeetWebhookService(stubDb([{ id: 'room-2', channelId: null }]), realtime);
    await svc.handle(
      event('room_finished', { room: { name: 'meet-room-2' } } as Partial<WebhookEvent>),
    );
    expect(realtime.emitToRoom).not.toHaveBeenCalled();
  });
});
