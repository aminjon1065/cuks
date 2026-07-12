import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_VERSION } from '@cuks/shared';

describe('Health (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // Valid-but-unreachable env: config validation passes, dependency probes
    // fail fast (connection refused on port 1) — no live infra required.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://cuks:cuks@127.0.0.1:1/cuks',
      REDIS_URL: 'redis://127.0.0.1:1',
      SESSION_SECRET: 'test-session-secret-at-least-32-chars-long',
      S3_ENDPOINT: 'http://127.0.0.1:1',
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
    });

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health → 200 liveness', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('GET /api/health/ready → 503 when dependencies are unreachable', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.dependencies).toEqual({
      postgres: 'down',
      redis: 'down',
      minio: 'down',
    });
  });
});
