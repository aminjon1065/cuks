import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  createIncidentReportSchema,
  createIncidentResourceSchema,
  createIncidentSchema,
  createSavedIncidentFilterSchema,
  incidentRegistryFilterSchema,
  listIncidentsQuerySchema,
  type CreateIncidentInput,
  type CreateIncidentReportInput,
  type CreateIncidentResourceInput,
  type CreateSavedIncidentFilterInput,
  type IncidentDetailDto,
  type IncidentListItemDto,
  type IncidentRegistryFilters,
  type ListIncidentsQuery,
  type PaginatedResult,
  type SavedIncidentFilterDto,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IncidentsService } from './incidents.service';

const idSchema = z.string().uuid();

@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @RequirePermission('gis.view')
  @ApiOperation({ summary: 'List emergency incidents' })
  list(
    @Query(new ZodValidationPipe(listIncidentsQuerySchema)) query: ListIncidentsQuery,
  ): Promise<PaginatedResult<IncidentListItemDto>> {
    return this.incidents.list(query);
  }

  @Get('saved-filters')
  @RequirePermission('gis.view')
  @ApiOperation({ summary: 'List my saved incident registry filters' })
  savedFilters(@CurrentUser() user: AuthUser): Promise<SavedIncidentFilterDto[]> {
    return this.incidents.listSavedFilters(user.id);
  }

  @Post('saved-filters')
  @RequirePermission('gis.view')
  @ApiOperation({ summary: 'Save an incident registry filter' })
  saveFilter(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSavedIncidentFilterSchema))
    body: CreateSavedIncidentFilterInput,
  ): Promise<SavedIncidentFilterDto> {
    return this.incidents.saveFilter(user.id, body);
  }

  @Delete('saved-filters/:id')
  @RequirePermission('gis.view')
  @HttpCode(200)
  async removeFilter(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.incidents.removeSavedFilter(id, user.id);
    return { ok: true };
  }

  @Post('export')
  @RequirePermission('gis.export')
  @ApiOperation({ summary: 'Export an incident registry selection as XLSX' })
  @ApiOkResponse({ description: 'XLSX workbook attachment' })
  async exportXlsx(
    @Body(new ZodValidationPipe(incidentRegistryFilterSchema)) body: IncidentRegistryFilters,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    reply.header('content-disposition', 'attachment; filename="incidents.xlsx"');
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return this.incidents.exportXlsx(body);
  }

  @Post()
  @RequirePermission('incidents.create')
  @ApiOperation({ summary: 'Create an emergency incident from the first report' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createIncidentSchema)) body: CreateIncidentInput,
  ): Promise<IncidentDetailDto> {
    return this.incidents.create(body, user);
  }

  @Get(':id')
  @RequirePermission('gis.view')
  @ApiOperation({ summary: 'Get an incident card with reports and resources' })
  detail(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<IncidentDetailDto> {
    return this.incidents.detail(id);
  }

  @Post(':id/reports')
  @RequirePermission('incidents.create')
  @ApiOperation({ summary: 'Add a chronological incident report' })
  addReport(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(createIncidentReportSchema)) body: CreateIncidentReportInput,
  ): Promise<IncidentDetailDto> {
    return this.incidents.addReport(id, body, user);
  }

  @Post(':id/resources')
  @RequirePermission('incidents.manage')
  @ApiOperation({ summary: 'Add deployed forces or assets to an incident' })
  addResource(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(createIncidentResourceSchema)) body: CreateIncidentResourceInput,
  ): Promise<IncidentDetailDto> {
    return this.incidents.addResource(id, body);
  }
}
