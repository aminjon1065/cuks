import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE, type EmailJobData } from '@cuks/shared';

export type MailMessage = EmailJobData;

/**
 * Mail façade (docs/02 §Email). Enqueues an `email` job onto BullMQ; the worker owns
 * the SMTP transport and does the actual send with retries (docs/01 §73). Callers are
 * unchanged from the 0.10 inline version — a mail failure still can't break the
 * originating action (enqueue errors are swallowed and logged).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@InjectQueue(QUEUE.email) private readonly queue: Queue<EmailJobData>) {}

  async send(message: MailMessage): Promise<void> {
    try {
      await this.queue.add('send', message);
    } catch (err) {
      this.logger.error({ err, to: message.to }, 'failed to enqueue email');
    }
  }
}
