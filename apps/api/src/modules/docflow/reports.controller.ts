import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  disciplineReportQuerySchema,
  type DisciplineReportDto,
  type DisciplineReportQuery,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ReportsService } from './reports.service';

/** Executive-discipline reports (docs/modules/11 §5, task 3.9). Gated by `docflow.reports.view`;
 *  the report exposes counts only, so it carries no document content. */
@ApiTags('docflow')
@Controller('docflow/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

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
}
