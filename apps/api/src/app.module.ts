import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.isProduction ? 'info' : 'debug',
          // Pretty logs in dev only; JSON in prod. `exactOptionalPropertyTypes`
          // forbids passing `transport: undefined`, so spread it in conditionally.
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
    HealthModule,
  ],
})
export class AppModule {}
