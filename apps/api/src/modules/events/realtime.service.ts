import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import { wsRooms, type WsEventName, type WsEventPayloads } from '@cuks/shared';

/**
 * Thin publish API over the Socket.IO server (docs/01 §Realtime). Feature modules
 * (notifications in 0.10, chat, calls, …) inject this to push events without
 * depending on the gateway. The gateway binds the live server via {@link bind}.
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  bind(server: Server): void {
    this.server = server;
  }

  /** Push to every socket of one user (their `user:{id}` room). */
  emitToUser<E extends WsEventName>(userId: string, event: E, payload: WsEventPayloads[E]): void {
    this.server?.to(wsRooms.user(userId)).emit(event, payload);
  }

  /** Push to an arbitrary room (channel/board/entity — see {@link wsRooms}). */
  emitToRoom<E extends WsEventName>(room: string, event: E, payload: WsEventPayloads[E]): void {
    this.server?.to(room).emit(event, payload);
  }
}
