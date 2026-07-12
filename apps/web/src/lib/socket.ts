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
    setSocket(s);
    const onConnect = (): void => setConnected(true);
    const onDisconnect = (): void => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.disconnect();
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
