import { describe, expect, it, vi } from 'vitest';
import { wsRooms } from '@cuks/shared';
import { RealtimeService } from './realtime.service';

describe('RealtimeService', () => {
  it('emits to the target user room', () => {
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    const service = new RealtimeService();
    service.bind({ to } as never);

    service.emitToUser('u1', 'notify.new', { id: 'n1', kind: 'test', createdAt: 'now' });

    expect(to).toHaveBeenCalledWith(wsRooms.user('u1'));
    expect(emit).toHaveBeenCalledWith('notify.new', { id: 'n1', kind: 'test', createdAt: 'now' });
  });

  it('is a no-op before the server is bound', () => {
    const service = new RealtimeService();
    expect(() =>
      service.emitToUser('u1', 'notify.new', { id: 'n1', kind: 'test', createdAt: 'now' }),
    ).not.toThrow();
  });
});
