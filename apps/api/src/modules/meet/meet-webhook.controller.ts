import { Body, Controller, Headers, HttpCode, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { LivekitService } from './livekit.service';
import { MeetWebhookService } from './meet-webhook.service';

/**
 * Inbound LiveKit webhooks (docs/modules/14 §6). Version-neutral so the URL in
 * livekit.yaml stays stable across API versions, and @Public because no session or
 * CSRF is expected: the request authenticates itself with the signed `Authorization`
 * JWT, verified in {@link LivekitService}. The body arrives as `application/webhook
 * +json` — a raw-string parser in main.ts preserves the exact bytes the signature
 * is computed over.
 */
@ApiTags('meet')
@Controller({ path: 'meet', version: VERSION_NEUTRAL })
export class MeetWebhookController {
  constructor(
    private readonly livekit: LivekitService,
    private readonly meetWebhook: MeetWebhookService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(
    @Body() body: string,
    @Headers('authorization') authHeader?: string,
  ): Promise<{ received: boolean }> {
    // Not configured: accept-and-ignore so a deployment without calls doesn't get
    // hammered by LiveKit's retry-on-non-2xx.
    if (!this.livekit.enabled) return { received: false };

    let event;
    try {
      event = await this.livekit.receiveWebhook(body, authHeader);
    } catch {
      // Missing/forged signature or a body tampered after signing.
      throw AppException.forbidden('meet.webhook.invalid', 'Invalid webhook signature');
    }
    this.meetWebhook.handle(event);
    return { received: true };
  }
}
