import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  analyticsStatsQuerySchema,
  analyticsSummaryQuerySchema,
  reportExportSchema,
  reportQuerySchema,
  saveReportSchema,
  type AnalyticsStatsDto,
  type AnalyticsStatsQuery,
  type AnalyticsSummaryDto,
  type AnalyticsSummaryQuery,
  type RegionFeatureCollection,
  type ReportExportInput,
  type ReportQuery,
  type ReportResultDto,
  type SavedReportDto,
  type SaveReportInput,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

const idSchema = z.string().uuid();

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
    @CurrentUser() user: AuthUser,
  ): Promise<AnalyticsSummaryDto> {
    return this.analytics.summary(query, user);
  }

  @Get('stats')
  @RequirePermission('analytics.view')
  @ApiOperation({ summary: 'Incident statistics: monthly, by type/region, heatmap, casualties' })
  @ApiOkResponse({ description: 'Aggregated incident statistics for the filter' })
  stats(
    @Query(new ZodValidationPipe(analyticsStatsQuerySchema)) query: AnalyticsStatsQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<AnalyticsStatsDto> {
    return this.analytics.stats(query, user);
  }

  @Get('regions.geojson')
  @RequirePermission('analytics.view')
  @ApiOperation({ summary: 'Region boundaries (GeoJSON) for the statistics choropleth' })
  @ApiOkResponse({ description: 'Region boundaries as a GeoJSON FeatureCollection' })
  regions(): Promise<RegionFeatureCollection> {
    return this.analytics.regionsGeoJson();
  }

  // --- Конструктор отчётов (docs/modules/10 §8, task 2.12) ---

  @Post('query')
  @RequirePermission('analytics.build')
  @ApiOperation({ summary: 'Run a report: aggregate incidents by dimensions and metrics' })
  @ApiOkResponse({ description: 'Aggregated report table' })
  query(
    @Body(new ZodValidationPipe(reportQuerySchema)) body: ReportQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<ReportResultDto> {
    return this.analytics.query(body, user);
  }

  @Post('query/export')
  @RequirePermission('analytics.build')
  @ApiOperation({ summary: 'Export a report as XLSX with a КЧС letterhead' })
  @ApiOkResponse({ description: 'XLSX workbook attachment' })
  async exportQuery(
    @Body(new ZodValidationPipe(reportExportSchema)) body: ReportExportInput,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    reply.header('content-disposition', 'attachment; filename="report.xlsx"');
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return this.analytics.exportReport(body, user);
  }

  @Get('reports')
  @RequirePermission('analytics.build')
  @ApiOperation({ summary: 'List my saved report definitions' })
  reports(@CurrentUser() user: AuthUser): Promise<SavedReportDto[]> {
    return this.analytics.listReports(user.id);
  }

  @Post('reports')
  @RequirePermission('analytics.build')
  @ApiOperation({ summary: 'Save the current report definition' })
  saveReport(
    @Body(new ZodValidationPipe(saveReportSchema)) body: SaveReportInput,
    @CurrentUser() user: AuthUser,
  ): Promise<SavedReportDto> {
    return this.analytics.saveReport(user.id, body);
  }

  @Delete('reports/:id')
  @RequirePermission('analytics.build')
  @ApiOperation({ summary: 'Delete a saved report' })
  removeReport(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.analytics.removeReport(user.id, id);
  }
}
