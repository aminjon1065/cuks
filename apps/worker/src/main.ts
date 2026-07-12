import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  const logger = new Logger('Worker');
  logger.log('Worker started (no queues yet — phase 0.13).');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal}, shutting down.`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep the process alive until real queues are added (phase 0.13).
  setInterval(() => undefined, 60_000);
}

void bootstrap();
