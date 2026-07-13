import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ConfigService } from '../../config/config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * SMTP sender (docs/02 §Email: Nodemailer → maildev in dev, corporate SMTP in prod;
 * `SMTP_URL`). A thin façade so phase 0.13 can move sending behind the BullMQ email
 * queue without touching callers. If `SMTP_URL` is unset the send is a logged no-op,
 * so the platform runs without a mail server configured.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from = 'CUKS <no-reply@cuks.local>';

  constructor(config: ConfigService) {
    const url = config.get('SMTP_URL');
    this.transporter = url ? createTransport(url) : null;
    if (!this.transporter) {
      this.logger.warn('SMTP_URL is not set — outgoing email is disabled');
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) return;
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (err) {
      // Email is best-effort: a mail failure must never break the originating action.
      this.logger.error({ err, to: message.to }, 'failed to send email');
    }
  }
}
