import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import { QUEUE, type EmailJobData } from '@cuks/shared';

export type MailMessage = EmailJobData;

export interface MailSendOptions {
  delayMs?: number;
  /** Stable delivery identity; hashed because BullMQ custom ids cannot contain `:`. */
  dedupeKey?: string;
}

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

  async send(message: MailMessage, options: MailSendOptions = {}): Promise<void> {
    try {
      const queueOptions = {
        ...(options.delayMs && options.delayMs > 0 ? { delay: options.delayMs } : {}),
        ...(options.dedupeKey
          ? { jobId: `mail-${createHash('sha256').update(options.dedupeKey).digest('hex')}` }
          : {}),
      };
      if (Object.keys(queueOptions).length > 0) {
        await this.queue.add('send', message, queueOptions);
      } else {
        await this.queue.add('send', message);
      }
    } catch (err) {
      this.logger.error({ err, to: message.to }, 'failed to enqueue email');
    }
  }
}
