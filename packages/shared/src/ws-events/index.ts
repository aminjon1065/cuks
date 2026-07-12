/**
 * Socket.IO event map: name -> payload (docs/04 §WebSocket). Namespace `/ws`,
 * events are `module.entity.action`. Extended per module as features land.
 */
export interface WsEventPayloads {
  'notify.new': { id: string; kind: string; createdAt: string };
  'presence.changed': { userId: string; online: boolean };
}

export type WsEventName = keyof WsEventPayloads;
