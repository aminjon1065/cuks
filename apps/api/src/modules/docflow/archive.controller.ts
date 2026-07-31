import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  archiveDocumentSchema,
  archiveQuerySchema,
  createDispositionBatchSchema,
  dispositionDecisionSchema,
  dispositionItemsSchema,
  legalHoldSchema,
  restoreDocumentSchema,
  type ArchiveDocumentInput,
  type ArchiveEntryDto,
  type ArchiveQuery,
  type CreateDispositionBatchInput,
  type DispositionBatchDto,
  type DispositionDecisionInput,
  type DispositionItemsInput,
  type DocumentDetailDto,
  type LegalHoldInput,
  type PaginatedResult,
  type RestoreDocumentInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ArchiveService } from './archive.service';

const uuidSchema = z.string().uuid();

/**
 * Archive, legal hold and acts of disposal (docs/modules/11 §12.12, plan §7.8).
 *
 * The permission on each route is the WEAKEST one that can reach it; the service then checks
 * the specific right the act needs (`docflow.archive.hold` for a hold,
 * `docflow.archive.dispose` for an act) and the caller's visibility of the specific document.
 * Nothing here deletes an object from storage — disposal is logical in this release.
 */
@ApiTags('docflow')
@Controller('docflow')
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Get('archive')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'The archive inventory: what is filed where, and until when' })
  list(
    @Query(new ZodValidationPipe(archiveQuerySchema)) query: ArchiveQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<ArchiveEntryDto>> {
    return this.archive.list(query, user);
  }

  @Post('documents/:id/actions/archive')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'File the document into its case, freezing its retention term' })
  archiveDocument(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(archiveDocumentSchema)) body: ArchiveDocumentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.archive.archive(id, body, user);
  }

  @Post('documents/:id/actions/restore')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take the document back out of the archive, with a reason' })
  restoreDocument(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(restoreDocumentSchema)) body: RestoreDocumentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.archive.restore(id, body, user);
  }

  @Post('documents/:id/actions/legal-hold')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a legal hold: the document can no longer be disposed of' })
  setLegalHold(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(legalHoldSchema)) body: LegalHoldInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.archive.setLegalHold(id, body, user);
  }

  @Delete('documents/:id/legal-hold')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lift the legal hold, with a reason' })
  clearLegalHold(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(legalHoldSchema)) body: LegalHoldInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.archive.clearLegalHold(id, body, user);
  }

  // --- Acts of disposal -------------------------------------------------------------

  @Get('archive/disposition-batches')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Acts of disposal, newest first' })
  listBatches(@CurrentUser() user: AuthUser): Promise<DispositionBatchDto[]> {
    return this.archive.listBatches(user);
  }

  @Post('archive/disposition-batches')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Draft an act of disposal' })
  createBatch(
    @Body(new ZodValidationPipe(createDispositionBatchSchema)) body: CreateDispositionBatchInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.createBatch(body, user);
  }

  @Post('archive/disposition-batches/:id/items')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add documents to a draft act' })
  addItems(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(dispositionItemsSchema)) body: DispositionItemsInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.addItems(id, body, user);
  }

  @Post('archive/disposition-batches/:id/actions/submit')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hand the act to a reviewer' })
  submitBatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.submitBatch(id, user);
  }

  @Post('archive/disposition-batches/:id/actions/approve')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve the act — never its own author' })
  approveBatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(dispositionDecisionSchema)) body: DispositionDecisionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.decideBatch(id, 'approve', body, user);
  }

  @Post('archive/disposition-batches/:id/actions/reject')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Return the act, leaving its documents ordinary archived records' })
  rejectBatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(dispositionDecisionSchema)) body: DispositionDecisionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.decideBatch(id, 'reject', body, user);
  }

  @Post('archive/disposition-batches/:id/actions/execute')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Carry out an approved act — logical disposal, nothing is deleted' })
  executeBatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.executeBatch(id, user);
  }
}
