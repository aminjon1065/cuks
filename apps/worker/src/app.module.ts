import { Module } from '@nestjs/common';

/**
 * Worker root module. BullMQ queues (av-scan, preview, text-extract, geo,
 * notifications, email, deadlines, retention, recordings) are wired in phase 0.13
 * and fleshed out per feature phase (docs/01 §Фоновые задачи).
 */
@Module({})
export class AppModule {}
