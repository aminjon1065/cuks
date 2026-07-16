import { Injectable, Logger } from '@nestjs/common';
import type { WebhookEvent } from 'livekit-server-sdk';

export interface WebhookHandlingResult {
  event: string;
  handled: boolean;
}

/**
 * Dispatches verified LiveKit webhook events (docs/modules/14 §6). In task 6.1 this
 * only observes the room/participant/egress lifecycle (logging); the persistence
 * hooks land with their tables so the event plumbing is proven end-to-end first:
 *   - participant_joined/left, room_finished -> meet_calls history (task 6.2)
 *   - egress_ended                            -> recordings card (task 6.6)
 * Kept side-effect-light and total: an unknown or newly-added LiveKit event is
 * logged and acknowledged rather than throwing, so the webhook never 500s (which
 * would make LiveKit retry indefinitely).
 */
@Injectable()
export class MeetWebhookService {
  private readonly logger = new Logger(MeetWebhookService.name);

  handle(event: WebhookEvent): WebhookHandlingResult {
    const name = event.event;
    switch (name) {
      case 'room_started':
      case 'room_finished':
      case 'participant_joined':
      case 'participant_left':
      case 'participant_connection_aborted':
      case 'track_published':
      case 'track_unpublished':
      case 'egress_started':
      case 'egress_updated':
      case 'egress_ended':
        this.logger.debug(`livekit webhook: ${name} (id=${event.id})`);
        return { event: name, handled: true };
      default:
        this.logger.debug(`livekit webhook: unhandled event "${name}"`);
        return { event: name, handled: false };
    }
  }
}
