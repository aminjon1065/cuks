import './config/load-env';
import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { API_VERSION } from '@cuks/shared';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.flushLogs();

  const config = app.get(ConfigService);

  // `/api` prefix; resources are versioned (`/api/v1/*`), health stays neutral.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  app.enableCors({ origin: config.get('APP_ORIGIN'), credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CUKS API')
    .setDescription('CUKS platform REST API')
    .setVersion('0.0.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.get('PORT');
  const host = config.get('HOST');
  await app.listen({ port, host });
}

void bootstrap();
