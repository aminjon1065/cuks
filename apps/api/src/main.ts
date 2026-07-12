import './config/load-env';
import 'reflect-metadata';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Redis } from 'ioredis';
import { API_VERSION } from '@cuks/shared';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { REDIS } from './common/redis/redis.module';
import { ConfigService } from './config/config.service';

/** Parse TRUST_PROXY: hop count, comma-separated subnets, or trust none by default. */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (!raw) return false;
  if (raw === 'true') return true;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: parseTrustProxy(process.env.TRUST_PROXY) }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.flushLogs();

  const config = app.get(ConfigService);

  // Cookie parsing/signing for session + CSRF cookies (docs/05 §1).
  await app.register(cookie, { secret: config.get('SESSION_SECRET') });

  // Security headers (docs/09 §1). Strict CSP + HSTS only in production, where
  // the API serves JSON only (Swagger is dev-only, see below); the SPA's own CSP
  // is applied at the edge (Caddy). Frame/nosniff/referrer apply everywhere.
  await app.register(helmet, {
    contentSecurityPolicy: config.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            connectSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            mediaSrc: ["'self'", 'blob:'],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
          },
        }
      : false,
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'same-origin' },
  });

  // `/api` prefix; resources are versioned (`/api/v1/*`), health stays neutral.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  app.enableCors({ origin: config.get('APP_ORIGIN'), credentials: true });

  // Swagger only outside production — avoid publishing the API map to anonymous
  // users on the internet (docs/09 threat model).
  if (!config.isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CUKS API')
      .setDescription('CUKS platform REST API')
      .setVersion('0.0.0')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  // Socket.IO on `/ws` with the Redis adapter (docs/01 §Realtime). Pub/sub run on
  // their own connections so subscriber mode never disturbs the session client.
  const redis = app.get<Redis>(REDIS);
  app.useWebSocketAdapter(
    new RedisIoAdapter(app, redis.duplicate(), redis.duplicate(), config.get('APP_ORIGIN')),
  );

  const port = config.get('PORT');
  const host = config.get('HOST');
  await app.listen({ port, host });
}

bootstrap().catch((err: unknown) => {
  // Startup failed (env validation, port in use, …) — log and exit non-zero.
  console.error('Fatal: API failed to start', err);
  process.exit(1);
});
