import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { HealthOverview, QueueRetryResult } from '@cuks/shared';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { AdminHealthService } from './admin-health.service';

/**
 * Admin platform-health dashboard API (docs/modules/16 §7, task 7.3). Read-only overview + a
 * retry-failed-jobs action, gated on `admin.system.monitor`.
 */
@ApiTags('admin')
@RequirePermission('admin.system.monitor')
@Controller('admin/health')
export class AdminHealthController {
  constructor(private readonly health: AdminHealthService) {}

  @Get()
  overview(): Promise<HealthOverview> {
    return this.health.overview();
  }

  @Post('queues/:name/retry')
  async retryQueue(@Param('name') name: string): Promise<QueueRetryResult> {
    const retried = await this.health.retryQueue(name);
    if (retried === null) {
      throw AppException.notFound('monitoring.queue.not_found', `Unknown queue "${name}"`);
    }
    return { name, retried };
  }
}
