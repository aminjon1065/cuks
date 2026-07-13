import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { createTransport, type Transporter } from 'nodemailer';
import { QUEUE, type EmailJobData } from '@cuks/shared';
import type { WorkerEnv } from '../../config/env';

const MAIL_FROM = 'CUKS <no-reply@cuks.local>';

/**
 * `email` queue consumer (docs/01 §73, docs/02 §Email). Owns the nodemailer/SMTP
 * transport; BullMQ handles retries/backoff. A throw fails the job so it retries;
 * if `SMTP_URL` is unset the send is a logged no-op (platform runs without mail).
 */
@Processor(QUEUE.email)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly transporter: Transporter | null;

  constructor(config: ConfigService<WorkerEnv, true>) {
    super();
    const url = config.get('SMTP_URL', { infer: true });
    this.transporter = url ? createTransport(url) : null;
    if (!this.transporter) this.logger.warn('SMTP_URL is not set — email sending disabled');
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    if (!this.transporter) return;
    const { to, subject, text, html } = job.data;
    await this.transporter.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });
    this.logger.log({ jobId: job.id, to }, 'email sent');
  }
}
