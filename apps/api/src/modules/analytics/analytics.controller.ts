import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  analyticsSummaryQuerySchema,
  type AnalyticsSummaryDto,
  type AnalyticsSummaryQuery,
} from '@cuks/shared';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @RequirePermission('analytics.view')
  @ApiOperation({ summary: 'Operational summary: KPIs, active incidents and latest reports' })
  @ApiOkResponse({ description: 'Operational summary for the selected period' })
  summary(
    @Query(new ZodValidationPipe(analyticsSummaryQuerySchema)) query: AnalyticsSummaryQuery,
  ): Promise<AnalyticsSummaryDto> {
    return this.analytics.summary(query);
  }
}
