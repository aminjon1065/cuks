import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  analyticsStatsQuerySchema,
  analyticsSummaryQuerySchema,
  type AnalyticsStatsDto,
  type AnalyticsStatsQuery,
  type AnalyticsSummaryDto,
  type AnalyticsSummaryQuery,
  type RegionFeatureCollection,
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

  @Get('stats')
  @RequirePermission('analytics.view')
  @ApiOperation({ summary: 'Incident statistics: monthly, by type/region, heatmap, casualties' })
  @ApiOkResponse({ description: 'Aggregated incident statistics for the filter' })
  stats(
    @Query(new ZodValidationPipe(analyticsStatsQuerySchema)) query: AnalyticsStatsQuery,
  ): Promise<AnalyticsStatsDto> {
    return this.analytics.stats(query);
  }

  @Get('regions.geojson')
  @RequirePermission('analytics.view')
  @ApiOperation({ summary: 'Region boundaries (GeoJSON) for the statistics choropleth' })
  @ApiOkResponse({ description: 'Region boundaries as a GeoJSON FeatureCollection' })
  regions(): Promise<RegionFeatureCollection> {
    return this.analytics.regionsGeoJson();
  }
}
