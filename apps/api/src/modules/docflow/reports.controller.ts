import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  registerReportQuerySchema,
  type RegisterReportDto,
  type RegisterReportQuery,
  acknowledgementReportQuerySchema,
  disciplineReportQuerySchema,
  type AcknowledgementReportDto,
  type AcknowledgementReportQuery,
  type DisciplineReportDto,
  type DisciplineReportQuery,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ReportsService } from './reports.service';
import { RegisterReportsService } from './register-reports.service';

/**
 * Docflow reports (docs/modules/11 §5, plan этап 7). Both are gated by
 * `docflow.reports.view`, but that permission means different things to them: the discipline
 * report exposes counts only, while the acknowledgement report names documents and readers
 * and therefore filters every row against the caller's own visibility inside the service.
 */
@ApiTags('docflow')
@Controller('docflow/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly registerReports: RegisterReportsService,
  ) {}

  @Get('discipline')
  @RequirePermission('docflow.reports.view')
  @ApiOperation({ summary: 'Executive-discipline report by subdivision and executor' })
  discipline(
    @Query(new ZodValidationPipe(disciplineReportQuerySchema)) query: DisciplineReportQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<DisciplineReportDto> {
    return this.reports.discipline(query, user);
  }

  @Get('discipline/export')
  @RequirePermission('docflow.reports.view')
  @ApiOperation({ summary: 'Executive-discipline report as an XLSX workbook' })
  @ApiOkResponse({ description: 'XLSX workbook attachment' })
  async disciplineExport(
    @Query(new ZodValidationPipe(disciplineReportQuerySchema)) query: DisciplineReportQuery,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    reply.header('content-disposition', 'attachment; filename="discipline.xlsx"');
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return this.reports.disciplineXlsx(query, user);
  }

  @Get('acknowledgement')
  @RequirePermission('docflow.reports.view')
  @ApiOperation({ summary: 'Who was told to read what, and who actually did' })
  acknowledgement(
    @Query(new ZodValidationPipe(acknowledgementReportQuerySchema))
    query: AcknowledgementReportQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<AcknowledgementReportDto> {
    return this.reports.acknowledgement(query, user);
  }

  @Get('acknowledgement/export')
  @RequirePermission('docflow.reports.view')
  @ApiOperation({ summary: 'Acknowledgement report as an XLSX workbook' })
  @ApiOkResponse({ description: 'XLSX workbook attachment' })
  async acknowledgementExport(
    @Query(new ZodValidationPipe(acknowledgementReportQuerySchema))
    query: AcknowledgementReportQuery,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    reply.header('content-disposition', 'attachment; filename="acknowledgement.xlsx"');
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return this.reports.acknowledgementXlsx(query, user);
  }

  @Get('register')
  @RequirePermission('docflow.reports.view')
  @ApiOperation({
    summary: 'Register reports: movement, registration, deadlines, dispatch, archive',
  })
  register(
    @Query(new ZodValidationPipe(registerReportQuerySchema)) query: RegisterReportQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<RegisterReportDto> {
    return this.registerReports.report(query, user);
  }

  @Get('register/export')
  @RequirePermission('docflow.reports.view')
  @ApiOperation({ summary: 'The same report as an XLSX workbook' })
  async registerExport(
    @Query(new ZodValidationPipe(registerReportQuerySchema)) query: RegisterReportQuery,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    reply.header('content-disposition', `attachment; filename="report-${query.kind}.xlsx"`);
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return this.registerReports.xlsx(query, user);
  }
}
