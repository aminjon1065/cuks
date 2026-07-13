import './config/load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  app.enableShutdownHooks(); // run OnModuleDestroy (close the DB pool) on shutdown
  const logger = new Logger('Worker');
  logger.log('Worker started — email, deadlines, audit-maintenance queues online.');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal}, shutting down.`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // BullMQ workers keep the event loop alive; no keep-alive timer needed.
}

void bootstrap().catch((err: unknown) => {
  console.error('Fatal: worker failed to start', err);
  process.exit(1);
});
