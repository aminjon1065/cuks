import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './common/audit/audit.module';
import { DbModule } from './common/db/db.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { MailModule } from './common/mail/mail.module';
import { CsrfGuard } from './common/guards/csrf.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { SessionGuard } from './common/guards/session.guard';
import { ThrottleGuard } from './common/guards/throttle.guard';
import { TotpEnrollmentGuard } from './common/guards/totp-enrollment.guard';
import { SlidingSessionInterceptor } from './common/interceptors/sliding-session.interceptor';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrgModule } from './modules/org/org.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.isProduction ? 'info' : 'debug',
          // Pretty logs in dev only; omit the key in prod (exactOptionalPropertyTypes).
          ...(config.isProduction
            ? {}
            : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
          // Never log secrets (docs/04 §Logging, docs/09 §1: authorization, cookie,
          // password, totp).
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.body.password',
            'req.body.totp',
            'res.headers["set-cookie"]',
          ],
          autoLogging: true,
        },
      }),
    }),
    RedisModule,
    DbModule,
    AuditModule,
    MailModule,
    UsersModule,
    AuthModule,
    AdminModule,
    OrgModule,
    EventsModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guard order matters: rate-limit → authenticate → force password change →
    // force 2FA enrollment → CSRF → permission.
    { provide: APP_GUARD, useClass: ThrottleGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: TotpEnrollmentGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: SlidingSessionInterceptor },
  ],
})
export class AppModule {}
