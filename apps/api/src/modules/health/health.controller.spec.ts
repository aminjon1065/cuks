import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('returns liveness from the service', async () => {
    const service = {
      liveness: vi.fn().mockReturnValue({ status: 'ok', uptimeSeconds: 5 }),
      readiness: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: service }],
    }).compile();

    const controller = moduleRef.get(HealthController);
    expect(controller.liveness()).toEqual({ status: 'ok', uptimeSeconds: 5 });
  });

  it('sets 503 when readiness is not ok', async () => {
    const service = {
      liveness: vi.fn(),
      readiness: vi.fn().mockResolvedValue({
        status: 'down',
        dependencies: { postgres: 'down', redis: 'down', minio: 'down' },
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: service }],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const status = vi.fn();
    const reply = { status } as unknown as FastifyReply;
    await controller.readiness(reply);
    expect(status).toHaveBeenCalledWith(503);
  });
});
