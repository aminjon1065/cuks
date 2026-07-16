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
  /** Registry/map clients refetch the incident tile source after a mutation. */
  'incidents.updated': {
    id: string;
    action: 'created' | 'reported' | 'resource_added' | 'status_changed';
  };
  /** A user's presence moved (docs/modules/13 §4): online on first socket / activity, away after
   *  10 min idle (derived at read time), offline on last disconnect. Broadcast to all sockets. */
  'presence.changed': {
    userId: string;
    status: 'online' | 'away' | 'offline';
    activityAt: string | null;
  };
  /** Someone is typing in a channel (docs/modules/13 §4/§5, throttled 3s client-side); the client
   *  resolves the name from the channel's member list and expires the hint after ~5s. */
  'chat.typing': { channelId: string; userId: string };
  /** A task board changed (docs/modules/15 §3); a `board:{projectId}` subscriber refetches or
   *  patches. `actorId` lets a client skip echoing its own optimistic change. */
  'tasks.card.created': { projectId: string; taskId: string; actorId: string };
  'tasks.card.updated': { projectId: string; taskId: string; actorId: string };
  'tasks.card.moved': {
    projectId: string;
    taskId: string;
    columnId: string;
    actorId: string;
  };
  'tasks.board.changed': { projectId: string; actorId: string };
  /** A chat message was posted to a channel (docs/modules/13 §5); `channel:{id}` subscribers append
   *  or refetch. `actorId` lets the sender skip echoing its own optimistic message. */
  'chat.message.created': { channelId: string; messageId: string; actorId: string };
  /** A channel's metadata or membership changed; subscribers refetch the channel / list. */
  'chat.channel.updated': { channelId: string; actorId: string };
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
  gis: (): string => 'gis',
  entity: (type: string, id: string): string => `entity:${type}:${id}`,
} as const;
