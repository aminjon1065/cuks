import { Injectable } from '@nestjs/common';
import { WebhookReceiver } from 'livekit-server-sdk';
import type { WebhookEvent } from 'livekit-server-sdk';
import { ConfigService } from '../../config/config.service';

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

  constructor(config: ConfigService) {
    this.apiKey = config.get('LIVEKIT_API_KEY');
    this.apiSecret = config.get('LIVEKIT_API_SECRET');
    this.url = config.get('LIVEKIT_URL');
  }

  /** True only when the SFU URL and API key/secret are all configured. */
  get enabled(): boolean {
    return Boolean(this.url && this.apiKey && this.apiSecret);
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
