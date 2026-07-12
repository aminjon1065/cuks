import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wsRooms } from '@cuks/shared';
import { EventsGateway, parseCookieHeader } from './events.gateway';

function makeSocket(cookie?: string) {
  return {
    id: 'sock1',
    handshake: { headers: cookie === undefined ? {} : { cookie } },
    data: {} as Record<string, unknown>,
    join: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makeGateway() {
  const sessions = { get: vi.fn() };
  const users = { findActiveById: vi.fn() };
  const realtime = { bind: vi.fn() };
  const gateway = new EventsGateway(sessions as never, users as never, realtime as never);
  return { gateway, sessions, users };
}

describe('parseCookieHeader', () => {
  it('parses a cookie header into a map', () => {
    expect(parseCookieHeader('cuks_session=abc; cuks_csrf=def')).toEqual({
      cuks_session: 'abc',
      cuks_csrf: 'def',
    });
  });

  it('returns an empty map for a missing header', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });
});

describe('EventsGateway.handleConnection', () => {
  let g: ReturnType<typeof makeGateway>;
  beforeEach(() => {
    g = makeGateway();
  });

  it('joins the user room and acks when the session is valid', async () => {
    g.sessions.get.mockResolvedValue({ userId: 'u1' });
    g.users.findActiveById.mockResolvedValue({ id: 'u1', status: 'active' });
    const socket = makeSocket('cuks_session=s1');

    await g.gateway.handleConnection(socket as never);

    expect(socket.join).toHaveBeenCalledWith(wsRooms.user('u1'));
    expect(socket.emit).toHaveBeenCalledWith('connection.ready', { userId: 'u1' });
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.data.userId).toBe('u1');
  });

  it('disconnects a socket with no session cookie', async () => {
    const socket = makeSocket();
    await g.gateway.handleConnection(socket as never);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('disconnects when the session is unknown', async () => {
    g.sessions.get.mockResolvedValue(null);
    const socket = makeSocket('cuks_session=stale');
    await g.gateway.handleConnection(socket as never);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects a blocked user', async () => {
    g.sessions.get.mockResolvedValue({ userId: 'u1' });
    g.users.findActiveById.mockResolvedValue({ id: 'u1', status: 'blocked' });
    const socket = makeSocket('cuks_session=s1');
    await g.gateway.handleConnection(socket as never);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });
});
