/**
 * Socket.IO contract (docs/01 §Realtime, docs/04 §WebSocket). Single namespace
 * `/ws`, authorized by the session cookie in the handshake. Event names are
 * `module.entity.action`; the payload map is extended per module as features land.
 */
export const WS_NAMESPACE = '/ws';

export interface WsEventPayloads {
  /** Emitted right after a socket authorizes and joins its user room. */
  'connection.ready': { userId: string };
  /** A new in-app notification arrived; the client refetches the feed/count. */
  'notify.new': { id: string; type: string; createdAt: string };
  /** The server ended this user's sessions (blocked / revoked) — client logs out. */
  'auth.forced_logout': { reason: string };
  'presence.changed': { userId: string; online: boolean };
}

export type WsEventName = keyof WsEventPayloads;

/**
 * Room naming. `user:{id}` — per-user (notifications, call ring); `channel:{id}` —
 * chat; `board:{id}` — task boards; `entity:{type}:{id}` — subscription to one card.
 */
export const wsRooms = {
  user: (userId: string): string => `user:${userId}`,
  channel: (channelId: string): string => `channel:${channelId}`,
  board: (boardId: string): string => `board:${boardId}`,
  entity: (type: string, id: string): string => `entity:${type}:${id}`,
} as const;
