import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  auditLogQuerySchema,
  type AuditLogDto,
  type AuditLogQuery,
  type PaginatedResult,
} from '@cuks/shared';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditQueryService } from './audit-query.service';

/** Audit-log viewer API (docs/09 §5). Admin-only; CSV export + full UI land in 0.12. */
@ApiTags('admin')
@RequirePermission('admin.audit.view')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<PaginatedResult<AuditLogDto>> {
    return this.audit.list(query);
  }
}
