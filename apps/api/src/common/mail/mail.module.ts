import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** SMTP sending, available app-wide (like AuditService). */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
