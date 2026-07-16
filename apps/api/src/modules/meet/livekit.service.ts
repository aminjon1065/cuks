import { Injectable } from '@nestjs/common';
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import type { VideoGrant, WebhookEvent } from 'livekit-server-sdk';
import type { MeetRoomRole } from '@cuks/shared';
import { ConfigService } from '../../config/config.service';

/** Inputs for a LiveKit join token (docs/modules/14 §6). */
export interface JoinTokenInput {
  /** The LiveKit room NAME (meet_rooms.livekit_room) — not the DB id. */
  room: string;
  /** Participant identity — the user id (unique per live participant in a room). */
  identity: string;
  /** Display name shown to other participants. */
  name: string;
  /** Avatar file id (or null) — carried in participant metadata for the room UI. */
  avatar: string | null;
  /** `host` gets room-admin powers (mute-all, remove, end); `participant` does not. */
  role: MeetRoomRole;
}

/** Join tokens are short-lived (docs/modules/14 §6: TTL 10 мин). */
const JOIN_TOKEN_TTL = '10m';

/**
 * Thin wrapper around the LiveKit server SDK (docs/modules/14 §6). The api is the
 * single source of truth for LiveKit: it signs join tokens (task 6.2) and verifies
 * the webhooks LiveKit posts back. Calls are wired only when all three credentials
 * are present, so the platform boots and runs without them.
 */
@Injectable()
export class LivekitService {
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;
  private readonly url: string | undefined;
  private receiver: WebhookReceiver | undefined;
  private roomClientInstance: RoomServiceClient | undefined;

  constructor(config: ConfigService) {
    this.apiKey = config.get('LIVEKIT_API_KEY');
    this.apiSecret = config.get('LIVEKIT_API_SECRET');
    this.url = config.get('LIVEKIT_URL');
  }

  /** True only when the SFU URL and API key/secret are all configured. */
  get enabled(): boolean {
    return Boolean(this.url && this.apiKey && this.apiSecret);
  }

  /** The browser-facing LiveKit WebSocket URL (`room.connect(url, token)`), or undefined if unset. */
  get publicUrl(): string | undefined {
    return this.url;
  }

  /**
   * Mint a LiveKit join token (docs/modules/14 §6). The api is the sole token source: rights are
   * checked before calling this, and the grants encode the participant's authority. A `host` also
   * gets `roomAdmin` — LiveKit gates every host RPC (mute-all, remove participant, end room) on that
   * single grant. `canPublishData` (default) carries the ephemeral room chat/reactions data channel.
   */
  async createJoinToken(input: JoinTokenInput): Promise<string> {
    if (!this.enabled || !this.apiKey || !this.apiSecret) {
      throw new Error('LiveKit is not configured');
    }
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: input.identity,
      name: input.name,
      ttl: JOIN_TOKEN_TTL,
      metadata: JSON.stringify({ avatar: input.avatar, role: input.role }),
    });
    const grant: VideoGrant = {
      roomJoin: true,
      room: input.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    };
    if (input.role === 'host') grant.roomAdmin = true;
    at.addGrant(grant);
    return at.toJwt();
  }

  /**
   * Server-side room moderation (docs/modules/14 §3, host actions). These use the RoomServiceClient
   * (api key/secret over the SFU's HTTP API), so authority never depends on the caller's own token —
   * the api re-checks that the caller is the room host before invoking any of them.
   */
  private get roomClient(): RoomServiceClient {
    if (!this.enabled || !this.apiKey || !this.apiSecret || !this.url) {
      throw new Error('LiveKit is not configured');
    }
    this.roomClientInstance ??= new RoomServiceClient(
      httpUrl(this.url),
      this.apiKey,
      this.apiSecret,
    );
    return this.roomClientInstance;
  }

  /** Mute a participant's microphone track(s). The host cannot un-mute — the participant may unmute
   *  themselves (docs/modules/14 §3: «mute участника (без unmute)»). No-op if they already left. */
  async muteParticipantAudio(room: string, identity: string): Promise<void> {
    const client = this.roomClient;
    const participants = await client.listParticipants(room);
    const target = participants.find((p) => p.identity === identity);
    if (!target) return;
    for (const track of target.tracks) {
      if (track.source === TrackSource.MICROPHONE && !track.muted) {
        await client.mutePublishedTrack(room, identity, track.sid, true);
      }
    }
  }

  /** Mute every participant's microphone except the host (docs/modules/14 §3: «выключить всем микрофоны»). */
  async muteAllExcept(room: string, exceptIdentity: string): Promise<void> {
    const client = this.roomClient;
    const participants = await client.listParticipants(room);
    for (const p of participants) {
      if (p.identity === exceptIdentity) continue;
      for (const track of p.tracks) {
        if (track.source === TrackSource.MICROPHONE && !track.muted) {
          await client.mutePublishedTrack(room, p.identity, track.sid, true);
        }
      }
    }
  }

  /** Disconnect a participant and stop them re-joining the current session (docs/modules/14 §3). */
  async removeParticipant(room: string, identity: string): Promise<void> {
    await this.roomClient.removeParticipant(room, identity).catch((err: unknown) => {
      // Already gone (removed / left) — treat as success.
      if (!isNotFoundError(err)) throw err;
    });
  }

  /** End the call for everyone (docs/modules/14 §3: «завершить встречу для всех»). */
  async endRoom(room: string): Promise<void> {
    await this.roomClient.deleteRoom(room).catch((err: unknown) => {
      if (!isNotFoundError(err)) throw err;
    });
  }

  /**
   * Verify a LiveKit webhook and parse its event. The `Authorization` header is a
   * JWT (issuer = api key, HS256 with the secret) whose `sha256` claim must equal
   * the hash of the exact request body — the SDK's WebhookReceiver enforces both,
   * so a forged token or a body tampered after signing is rejected (throws). The
   * caller must pass the raw body string (main.ts registers a raw-body parser for
   * `application/webhook+json`).
   */
  async receiveWebhook(body: string, authHeader: string | undefined): Promise<WebhookEvent> {
    if (!this.enabled || !this.apiKey || !this.apiSecret) {
      throw new Error('LiveKit is not configured');
    }
    this.receiver ??= new WebhookReceiver(this.apiKey, this.apiSecret);
    return this.receiver.receive(body, authHeader);
  }
}

/** The RoomServiceClient talks to the SFU's HTTP API — derive it from the ws(s) signaling URL. */
function httpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://');
}

/** LiveKit returns a 404-ish twirp error when a room/participant is already gone. */
function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes('not found') || message.includes('does not exist');
}
