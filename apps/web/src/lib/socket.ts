import { createContext, createElement, useContext, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { WS_NAMESPACE, type WsEventName, type WsEventPayloads } from '@cuks/shared';

/**
 * Socket.IO client (docs/01 §Realtime). One connection on the `/ws` namespace,
 * authorized by the session cookie (`withCredentials`). Mounted only inside the
 * authenticated shell, so it connects after login and tears down on logout.
 */
type ServerEvents = { [E in WsEventName]: (payload: WsEventPayloads[E]) => void };
export type AppSocket = Socket<ServerEvents>;

declare global {
  interface Window {
    /** Dev/e2e handle for verifying authenticated realtime delivery. */
    __cuksSocket?: AppSocket;
    /** True only after the gateway has authorized the socket and joined its rooms. */
    __cuksSocketReady?: boolean;
  }
}

interface SocketContextValue {
  socket: AppSocket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s: AppSocket = io(WS_NAMESPACE, {
      withCredentials: true,
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
    if (import.meta.env.DEV) {
      window.__cuksSocket = s;
      window.__cuksSocketReady = false;
    }
    setSocket(s);
    const onConnect = (): void => {
      setConnected(true);
      if (import.meta.env.DEV) window.__cuksSocketReady = false;
    };
    const onDisconnect = (): void => {
      setConnected(false);
      if (import.meta.env.DEV) window.__cuksSocketReady = false;
    };
    const onReady = (): void => {
      if (import.meta.env.DEV) window.__cuksSocketReady = true;
    };
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connection.ready', onReady);

    // Presence activity ping (docs/modules/13 §4): real user input resets the server's 10-minute
    // away timer, at most once a minute. The connect handshake stamps activity server-side, so the
    // first ping is only needed a minute into the session.
    let lastActivityPing = Date.now();
    const onActivity = (): void => {
      const now = Date.now();
      if (!s.connected || now - lastActivityPing < 60_000) return;
      lastActivityPing = now;
      // presence.activity is a client→server message, outside the server-event map.
      (s as unknown as { emit: (e: string) => void }).emit('presence.activity');
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);

    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connection.ready', onReady);
      s.disconnect();
      if (import.meta.env.DEV && window.__cuksSocket === s) {
        delete window.__cuksSocket;
        delete window.__cuksSocketReady;
      }
    };
  }, []);

  return createElement(SocketContext.Provider, { value: { socket, connected } }, children);
}

/** The live socket and connection state (null outside the provider). */
export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/** Subscribe to a typed server event for the lifetime of the calling component. */
export function useSocketEvent<E extends WsEventName>(
  event: E,
  handler: (payload: WsEventPayloads[E]) => void,
): void {
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler as never);
    return () => {
      socket.off(event, handler as never);
    };
  }, [socket, event, handler]);
}
