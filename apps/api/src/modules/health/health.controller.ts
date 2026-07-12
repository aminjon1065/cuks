import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { LivenessResult, ReadinessResult } from '@cuks/shared';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

/** Health endpoints — version-neutral, so `/api/health` (not `/api/v1/...`). */
@Public()
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOkResponse({ description: 'Liveness — the process is up.' })
  liveness(): LivenessResult {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'All dependencies reachable.' })
  @ApiServiceUnavailableResponse({ description: 'One or more dependencies are down.' })
  async readiness(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResult> {
    const result = await this.health.readiness();
    reply.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
