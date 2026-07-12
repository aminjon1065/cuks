import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './common/audit/audit.module';
import { DbModule } from './common/db/db.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CsrfGuard } from './common/guards/csrf.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { SessionGuard } from './common/guards/session.guard';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
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
    UsersModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guard order matters: authenticate → force password change → CSRF → permission.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
